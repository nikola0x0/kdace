// Staged runner (KDACE_STORE=supabase): the tick cut into stages that each fit well inside one Vercel function call
// (300 s), run by POST /api/tick every minute (Supabase pg_cron) and by the GitHub tick when it runs in supabase mode.
// One call: take the runner lock (one stage at a time, whoever calls), look at what has work, run the cheap settle
// stage if it has any, then at most one heavy stage, release the lock, and report. Calling it again drains the work.
//
//   settle   fan mirror + fast settle (results, AXP, board, voids) + fans' AXP back to Supabase (+ fan names)
//   final    one series' final call (five analysts in parallel)
//   pick     one new series (five analysts in parallel), plus interrupted commits and missed series
//   scout    Scout refresh into the store, at most every 30 minutes (a partial run carries on a minute later)
//   titles   the day's title calls (five analysts in parallel)
//   banter   one series' trash talk
//   graveyard one knocked-out team's farewell roast, from the analysts' calls and lessons on it
//   lessons  one series' debate and Walrus lessons, stopping before the time is up (resumes where it left off)
//
// Every stage is the existing job with the same resume rules (records written before chain calls, same hash on retry,
// never a second commit); the runner only bounds how much one call does and gives each LLM call and lock wait a deadline.
// A stage that makes no progress backs off (runner_state), so a broken dependency isn't retried every minute.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { needsBanter } from "../core/banter.ts";
import { chainOf, sameChain, type Chain } from "../core/chain.ts";
import type { FanCommitRow, FanDb } from "../core/fandb.ts";
import { finalCallDue } from "../core/finalcall.ts";
import { needsEulogy, type Graveyard } from "../core/graveyard.ts";
import { computeBoard, type BoardRow } from "../core/points.ts";
import { settleAction } from "../core/results.ts";
import { awaitingResult, isLocked, seriesToPick } from "../core/select.ts";
import { SCOUT_KEYS, toSettled, viewOf, type RecordStore, type SeriesRecord } from "../core/store.ts";
import { canonicalJson, type RunnerDb, type StageState } from "../core/supastore.ts";
import { utcDate, type TitleDay } from "../core/titles.ts";
import type { Series } from "../core/worlds.ts";
import { fanMirrorPending, unsettledFanCommits } from "./fans.ts";
import { needsReflection } from "./settle.ts";

export const STAGES = ["settle", "final", "pick", "scout", "titles", "banter", "lessons", "graveyard"] as const;
export type Stage = (typeof STAGES)[number];

/** What a stage reports. `retryInMs` overrides the default back-off; `touch` stamps extra state keys (e.g. "names"). */
export type StageOutcome = { progressed: boolean; detail: unknown; retryInMs?: number | null; touch?: string[] };

/** Handed to a stage: the schedule read at the start of the call (null when lolesports was down) and the time left. */
export type StageCtx = { schedule: Series[] | null; remainingMs(): number; now(): Date };

export type StageFns = Record<Stage, (ctx: StageCtx) => Promise<StageOutcome>>;

/** Everything the work check reads, gathered once per call. */
export type WorkView = {
  records: SeriesRecord[];
  board: BoardRow[];
  todayTitle: TitleDay | null;
  graveyard: Graveyard;
  schedule: Series[] | null;
  /** Fan commits from Supabase; null when there is no fan database or it couldn't be read. */
  fanCommits: FanCommitRow[] | null;
  hasFanDb: boolean;
  state: Record<string, StageState>;
  chain: Chain;
  now: Date;
};

/** How long a stage waits after a run that made no progress (or failed). */
export const BACKOFF_MS: Record<Stage, number> = { settle: 2 * 60_000, final: 60_000, pick: 5 * 60_000, scout: 30 * 60_000, titles: 30 * 60_000, banter: 15 * 60_000, lessons: 3 * 60_000, graveyard: 15 * 60_000 };
/** A heavy stage only starts with at least this much of the call's budget left. */
export const MIN_TIME_MS: Record<Stage, number> = { settle: 0, final: 150_000, pick: 200_000, scout: 90_000, titles: 150_000, banter: 60_000, lessons: 60_000, graveyard: 60_000 };
export const SCOUT_EVERY_MS = 30 * 60_000;
export const NAMES_EVERY_MS = 30 * 60_000;
/** Default budget per call: Vercel's 300 s limit minus a margin for the lock, state writes and the response. */
export const DEFAULT_BUDGET_MS = 270_000;

const ready = (v: WorkView, key: string) => {
  const next = v.state[key]?.nextAt;
  return !next || Date.parse(next) <= v.now.getTime();
};
const olderThan = (v: WorkView, key: string, ms: number) => {
  const last = v.state[key]?.lastAt;
  return !last || v.now.getTime() - Date.parse(last) >= ms;
};

/** The stages that have work now, in the order they run (settle first, then the heavy ones by priority), each with why. */
export function stagesWithWork(v: WorkView): { stage: Stage; reason: string }[] {
  const out: { stage: Stage; reason: string }[] = [];
  const add = (stage: Stage, reason: string | null) => {
    if (reason && ready(v, stage)) out.push({ stage, reason });
  };
  const byId = new Map((v.schedule ?? []).map((s) => [s.matchId, s]));

  // settle: a fan batch to mirror, a result to post or finish, a void due, fans' AXP to sync, a stale board, or names to refresh.
  const mirror = v.fanCommits ? fanMirrorPending(v.records, v.fanCommits, v.schedule ?? []) : [];
  const settle = v.records.filter((r) => awaitingResult(r) && (!!r.result || sameChain(chainOf(r), v.chain)) && settleAction(r, byId.get(r.series.matchId), v.schedule !== null, v.now).kind !== "wait");
  const axp = v.fanCommits ? unsettledFanCommits(v.fanCommits, v.records) : [];
  const boardStale = canonicalJson(computeBoard(v.records.filter((r) => r.status === "settled").map(toSettled))) !== canonicalJson(v.board);
  add("settle",
    mirror.length ? `fan batch to mirror: ${mirror.join(", ")}`
    : settle.length ? `result or void to settle: ${settle.map((r) => r.series.matchId).join(", ")}`
    : axp.length ? `fans' AXP to sync: ${axp.join(", ")}`
    : boardStale ? "board out of date"
    : v.hasFanDb && olderThan(v, "names", NAMES_EVERY_MS) ? "fan names refresh"
    : null);

  const committing = v.records.filter((r) => r.finalCall?.status === "committing");
  const finalDue = v.schedule ? v.records.filter((r) => sameChain(chainOf(r), v.chain) && finalCallDue(r, v.schedule!, v.records, v.now).due) : [];
  add("final", committing.length ? `final call to resume: ${committing[0].series.matchId}` : finalDue.length ? `final call due: ${finalDue[0].series.matchId}` : null);

  const resume = v.records.filter((r) => r.status === "committing");
  const open = v.schedule ? seriesToPick(v.schedule, viewOf(v.records), v.now) : { pick: [], missed: [] };
  add("pick",
    resume.length ? `commit to resume or mark missed: ${resume[0].series.matchId}`
    : open.missed.length ? `missed series to record: ${open.missed[0].matchId}`
    : open.pick.length ? `series to pick: ${[...open.pick].sort((a, b) => a.startTime.localeCompare(b.startTime))[0].matchId}`
    : null);

  add("scout", "Scout refresh");

  add("titles", v.todayTitle?.status === "committed" ? null : `title calls for ${utcDate(v.now)}`);

  const banter = v.records.filter((r) => needsBanter(r) && !isLocked(r.series.startTime, v.now));
  add("banter", banter.length ? `banter for ${banter[0].series.matchId}` : null);

  const lessons = v.records.filter(needsReflection);
  add("lessons", lessons.length ? `debate/lessons for ${lessons[0].series.matchId}` : null);

  const gone = v.schedule ? needsEulogy(v.schedule, v.records, v.graveyard) : [];
  add("graveyard", gone.length ? `farewell roast for ${gone[0].team}` : null);
  return out;
}

export type RunnerDeps = {
  store: RecordStore;
  db: RunnerDb;
  fanDb: FanDb | null;
  fetchSeries(): Promise<Series[]>;
  chain: Chain;
  stages: StageFns;
  budgetMs: number;
  now(): Date;
  log(msg: string): void;
};

export type StageRun = { stage: Stage; reason: string; outcome?: StageOutcome; error?: string; skipped?: string; ms?: number };
export type RunReport = { busy: boolean; ran: StageRun[]; idle: boolean; pending: Stage[] };

/** Reads what the work check needs, in parallel. The schedule and fan commits may fail (null); the store may not. */
export async function gatherView(deps: Pick<RunnerDeps, "store" | "db" | "fanDb" | "fetchSeries" | "chain" | "now" | "log">): Promise<WorkView> {
  const now = deps.now();
  const [records, board, todayTitle, graveyard, state, schedule, fanCommits] = await Promise.all([
    deps.store.all(),
    deps.store.readBoard(),
    deps.store.getTitleDay(utcDate(now)),
    deps.store.readGraveyard(),
    deps.db.readState(),
    deps.fetchSeries().catch((e) => (deps.log(`schedule unavailable: ${(e as Error).message}`), null)),
    deps.fanDb ? deps.fanDb.listCommits().catch((e) => (deps.log(`fan commits unavailable: ${(e as Error).message}`), null)) : Promise.resolve(null),
  ]);
  return { records, board, todayTitle, graveyard, state, schedule, fanCommits, hasFanDb: !!deps.fanDb, chain: deps.chain, now };
}

/** One call: lock, settle if due, then at most one heavy stage, unlock. Never throws for a stage failure (it is reported). */
export async function runOnce(deps: RunnerDeps, holder: string): Promise<RunReport> {
  const started = deps.now().getTime();
  const remainingMs = () => deps.budgetMs - (deps.now().getTime() - started);
  // The lock outlives the budget by a minute: a call Vercel kills mid-stage frees it on its own.
  if (!(await deps.db.acquireRunnerLock(holder, Math.ceil(deps.budgetMs / 1000) + 60))) return { busy: true, ran: [], idle: false, pending: [] };
  const ran: StageRun[] = [];
  try {
    let view = await gatherView(deps);
    let work = stagesWithWork(view);
    const run = async (stage: Stage, reason: string) => {
      const t0 = deps.now();
      const entry: StageRun = { stage, reason };
      ran.push(entry);
      deps.log(`${stage}: ${reason}`);
      let next: number | null;
      let note: string;
      try {
        const outcome = await deps.stages[stage]({ schedule: view.schedule, remainingMs, now: deps.now });
        entry.outcome = outcome;
        next = outcome.retryInMs !== undefined ? outcome.retryInMs : outcome.progressed ? null : BACKOFF_MS[stage];
        // What happened, kept in runner_state: function logs on the free plan don't last long enough to diagnose later.
        note = (outcome.progressed ? "progressed" : `no progress (${reason})`) + (outcome.detail !== undefined ? `: ${JSON.stringify(outcome.detail)}` : "");
        note = note.slice(0, 500);
        for (const key of outcome.touch ?? []) await deps.db.writeState(key, { nextAt: null, lastAt: t0.toISOString(), note: `by ${stage}` }).catch(() => {});
      } catch (e) {
        entry.error = (e as Error).message;
        next = BACKOFF_MS[stage];
        note = `failed: ${entry.error}`.slice(0, 500);
        deps.log(`${stage} failed: ${entry.error}`);
      }
      entry.ms = deps.now().getTime() - t0.getTime();
      const nextAt = next === null ? null : new Date(deps.now().getTime() + next).toISOString();
      await deps.db.writeState(stage, { nextAt, lastAt: t0.toISOString(), note }).catch((e) => deps.log(`state for ${stage} not saved: ${(e as Error).message}`));
    };
    if (work[0]?.stage === "settle") {
      await run("settle", work[0].reason);
      view = await gatherView(deps); // settling frees AXP and changes what the next stages see
      work = stagesWithWork(view);
    }
    const heavy = work.find((w) => w.stage !== "settle");
    if (heavy) {
      if (remainingMs() >= MIN_TIME_MS[heavy.stage]) await run(heavy.stage, heavy.reason);
      else ran.push({ stage: heavy.stage, reason: heavy.reason, skipped: `only ${Math.round(remainingMs() / 1000)} s left; next call` });
    }
    const done = new Set(ran.filter((r) => !r.skipped).map((r) => r.stage));
    return { busy: false, ran, idle: done.size === 0, pending: work.map((w) => w.stage).filter((s) => !done.has(s)) };
  } finally {
    await deps.db.releaseRunnerLock(holder).catch((e) => deps.log(`runner lock not released (expires on its own): ${(e as Error).message}`));
  }
}

/** Calls runOnce until nothing is left, another runner holds the lock, or `maxMs` has passed (the GitHub tick). */
export async function drain(deps: RunnerDeps, holder: string, maxMs: number): Promise<{ runs: number; stopped: "idle" | "busy" | "time" | "no progress" }> {
  const started = deps.now().getTime();
  for (let runs = 1; ; runs++) {
    const report = await runOnce(deps, holder);
    if (report.busy) return { runs, stopped: "busy" };
    if (report.idle) return { runs, stopped: "idle" };
    // Only back-offs left (everything that ran made no progress): stop rather than spin.
    if (report.ran.every((r) => r.skipped || r.error || !r.outcome?.progressed) && !report.pending.length) return { runs, stopped: "no progress" };
    if (deps.now().getTime() - started >= maxMs) return { runs, stopped: "time" };
  }
}

const clampMs = (ms: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, ms));

/** The real stages: the existing jobs with the runner's bounds (one item per call, parallel analysts, deadlines). */
export async function realStages(store: RecordStore, fanDb: FanDb | null, log: (stage: Stage, msg: string) => void): Promise<StageFns> {
  const { fetchSeries } = await import("../core/worlds.ts");
  const { askAnalyst, askAnalystFull } = await import("../core/llm.ts");
  const { commitBatch } = await import("../core/ledger.ts");
  const { withRefereeLock } = await import("../core/fandb.ts");
  const { memory } = await import("../core/memory.ts");
  const schedule = (ctx: StageCtx) => () => (ctx.schedule ? Promise.resolve(ctx.schedule) : fetchSeries());
  // Every LLM call gets what is left of the budget (minus a margin) and no SDK retries; the job's own retry still applies.
  const timeLeft = (ctx: StageCtx) => {
    const ms = ctx.remainingMs() - 20_000;
    if (ms < 15_000) throw new Error("out of time for another model call this run");
    return { timeoutMs: Math.min(ms, 240_000) };
  };
  const commit = (ctx: StageCtx) => (marketId: string, hash: string, count: number) =>
    withRefereeLock(fanDb, "tick", () => commitBatch(marketId, hash, count), { waitMs: clampMs(ctx.remainingMs() - 40_000, 5_000, 120_000), proceedIfDbDown: true });

  return {
    settle: async (ctx) => {
      const { mirrorFans, syncFanAxp } = await import("./fans.ts");
      const { realSettleDeps, runSettleFast } = await import("./settle.ts");
      const { postResult } = await import("../core/ledger.ts");
      let fansOk = true;
      let mirrored: string[] = [];
      let namesChanged = false;
      if (fanDb) {
        try {
          ({ mirrored, namesChanged } = await mirrorFans(store, fanDb, schedule(ctx), (m) => log("settle", `fans ${m}`)));
        } catch (e) {
          fansOk = false;
          log("settle", `fan commits could not be mirrored, settle skipped: ${(e as Error).message}`);
        }
      }
      const fast = fansOk
        ? await runSettleFast({
            ...(await realSettleDeps(store)),
            fetchSeries: schedule(ctx),
            postResult: (m, w, s) => withRefereeLock(fanDb, "tick", () => postResult(m, w, s), { waitMs: clampMs(ctx.remainingMs() - 40_000, 5_000, 120_000), proceedIfDbDown: true }),
            log: (m) => log("settle", m),
          })
        : null;
      let axp: { fans: number; settledCommits: string[] } | null = null;
      if (fanDb) {
        try {
          axp = await syncFanAxp(store, fanDb, ctx.now());
        } catch (e) {
          log("settle", `fan AXP sync failed: ${(e as Error).message}`);
        }
      }
      const progressed = mirrored.length > 0 || namesChanged || !!fast?.settled.length || !!fast?.voided.length || !!axp?.settledCommits.length;
      return { progressed, detail: { mirrored, namesChanged, fast, axp }, touch: fanDb && fansOk ? ["names"] : [] };
    },

    final: async (ctx) => {
      const { realFinalCallDeps, runFinalCall } = await import("./finalcall.ts");
      const out = await runFinalCall(
        { ...(await realFinalCallDeps(store)), fetchSeries: schedule(ctx), ask: (p) => askAnalystFull(p, "high", timeLeft(ctx)), commit: commit(ctx), log: (m) => log("final", m) },
        { maxNew: 1 },
      );
      return { progressed: out.committed.length + out.none.length + out.missed.length > 0, detail: out };
    },

    pick: async (ctx) => {
      const { realPickDeps, runPick } = await import("./pick.ts");
      const out = await runPick(
        { ...(await realPickDeps(store)), fetchSeries: schedule(ctx), ask: (p) => askAnalystFull(p, "xhigh", timeLeft(ctx)), commit: commit(ctx), log: (m) => log("pick", m) },
        { maxNew: 1, parallel: true },
      );
      return { progressed: out.committed.length + out.missed.length > 0, detail: out };
    },

    scout: async (ctx) => {
      const { refreshScout } = await import("./scout.ts");
      const dir = join(tmpdir(), "kdace-scout");
      mkdirSync(dir, { recursive: true });
      // Seeded with the stored games, so games already summarised are never fetched again (as with games.json in git).
      const games = await store.readScoutFile("games");
      if (games) writeFileSync(join(dir, "games.json"), JSON.stringify(games, null, 1) + "\n");
      const { complete, requests } = await refreshScout({ dir, deadline: Date.now() + ctx.remainingMs() - 30_000 });
      const files = Object.fromEntries(SCOUT_KEYS.map((k) => [k, JSON.parse(readFileSync(join(dir, `${k}.json`), "utf8"))]));
      await store.writeScout(files);
      return { progressed: true, detail: { complete, requests }, retryInMs: complete ? SCOUT_EVERY_MS : 60_000 };
    },

    titles: async (ctx) => {
      const { realTitleDeps, runTitles } = await import("./titles.ts");
      const out = await runTitles(
        { ...(await realTitleDeps(store)), fetchSeries: schedule(ctx), ask: (p) => askAnalyst(p, timeLeft(ctx)), commit: commit(ctx), log: (m) => log("titles", m) },
        { parallel: true },
      );
      const done = out.status === "committed" || out.status === "already picked";
      return { progressed: done, detail: out, retryInMs: done ? null : out.status === "tournament over" ? 6 * 3600_000 : BACKOFF_MS.titles };
    },

    banter: async (ctx) => {
      const { realBanterDeps, runBanter } = await import("./banter.ts");
      const done = await runBanter({ ...(await realBanterDeps(store)), ask: (p) => askAnalyst(p, timeLeft(ctx)), log: (m) => log("banter", m) }, 1);
      return { progressed: done.length > 0, detail: done };
    },

    graveyard: async (ctx) => {
      const { runGraveyard } = await import("./graveyard.ts");
      const done = await runGraveyard({ store, fetchSeries: schedule(ctx), ask: (p) => askAnalyst(p, timeLeft(ctx)), now: ctx.now, log: (m) => log("graveyard", m) }, 1);
      return { progressed: done.length > 0, detail: done };
    },

    lessons: async (ctx) => {
      const { realSettleDeps, runSettleSlow } = await import("./settle.ts");
      const before = canonicalJson((await store.all()).filter(needsReflection));
      const out = await runSettleSlow(
        {
          ...(await realSettleDeps(store)),
          ask: (p) => askAnalyst(p, timeLeft(ctx)),
          awaitRemember: async (role, jobId) => (await memory(`kdace-analyst-${role}`).waitForRememberJob(jobId, { timeoutMs: clampMs(ctx.remainingMs() - 30_000, 5_000, 90_000) })).blob_id,
          log: (m) => log("lessons", m),
        },
        { maxRecords: 1, outOfTime: () => ctx.remainingMs() < 45_000 },
      );
      // A debate or a single lesson saved is progress, even when the series isn't finished this call.
      const after = canonicalJson((await store.all()).filter(needsReflection));
      return { progressed: out.reflected.length > 0 || before !== after, detail: out };
    },
  };
}

/** The runner wired to the environment (KDACE_STORE=supabase): Supabase store, runner lock and state, real stages. */
export async function realRunnerDeps(opts: { budgetMs?: number } = {}): Promise<RunnerDeps> {
  const { fanDbFromEnv } = await import("../core/fandb.ts");
  const { SupabaseRunnerDb, SupabaseStore, supabaseRestFromEnv } = await import("../core/supastore.ts");
  const { fetchSeries } = await import("../core/worlds.ts");
  const { currentChain } = await import("../core/ledger.ts");
  const rest = supabaseRestFromEnv();
  const store = new SupabaseStore(rest);
  const fanDb = fanDbFromEnv();
  return {
    store,
    db: new SupabaseRunnerDb(rest),
    fanDb,
    fetchSeries,
    chain: currentChain(),
    stages: await realStages(store, fanDb, (stage, m) => console.log(`[${stage}] ${m}`)),
    budgetMs: opts.budgetMs ?? DEFAULT_BUDGET_MS,
    now: () => new Date(),
    log: (m) => console.log(`[runner] ${m}`),
  };
}

/** The GitHub tick in supabase mode: drain the work under the shared runner lock, then stop. */
export async function runUntilIdle(opts: { holder: string; maxMs: number }) {
  const deps = await realRunnerDeps();
  return drain(deps, opts.holder, opts.maxMs);
}
