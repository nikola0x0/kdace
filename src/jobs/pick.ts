// Pick job: every analyst picks each open series blind, and the batch fingerprint is committed before the game.
import { pathToFileURL } from "node:url";
import { withLock } from "../core/lock.ts";
import { analystEntries, analystStakes, ANALYSTS, buildPickPrompt, parsePick, type AnalystPick, type Lesson, type Role } from "../core/analysts.ts";
import { batchHash, canonicalBatch } from "../core/batch.ts";
import type { Chain } from "../core/chain.ts";
import { fanDbFromEnv, withRefereeLock } from "../core/fandb.ts";
import { isLocked, seriesToPick, seriesToResume } from "../core/select.ts";
import { axpAccount, Store, viewOf, type RecordStore, type SeriesRecord } from "../core/store.ts";
import type { AnalystReply } from "../core/llm.ts";
import type { Series } from "../core/worlds.ts";

export type PickDeps = {
  fetchSeries(): Promise<Series[]>;
  store: RecordStore;
  recall(role: Role, query: string): Promise<Lesson[]>;
  /** The analyst's reply; with thinking on, also its thinking summary. */
  ask(prompt: string): Promise<string | AnalystReply>;
  commit(matchId: string, hash: string, count: number): Promise<string>;
  /** Where commit() writes; stamped on each committed record. */
  chain: Chain;
  history(): string[];
  /** Scout's 2026 stats digest for a matchup (the store's Scout data), or null when there's none. */
  scout?(teamA: string, teamB: string): string | null;
  now(): Date;
  log(msg: string): void;
};

/** Options for one run. The defaults are the tick's behaviour; the Vercel runner bounds a run to one new series, analysts in parallel. */
export type PickOptions = {
  /** At most this many new series picked (soonest first); missed ones are always recorded. */
  maxNew?: number;
  /** Ask the five analysts at once instead of one after another. */
  parallel?: boolean;
};

const MIN_ANALYSTS = 3;

export const emptyRecord = (series: Series, status: SeriesRecord["status"]): SeriesRecord => ({
  series, status, picks: [], batch: null, batchHash: null, commitDigest: null, result: null, axp: null, debate: null, lessons: [],
});

async function analystPicks(deps: PickDeps, s: Series, scout: string | null, parallel: boolean): Promise<AnalystPick[]> {
  const history = deps.history();
  const records = await deps.store.all();
  const one = async (a: (typeof ANALYSTS)[number]): Promise<AnalystPick | null> => {
    // Stakes follow from confidence and the AXP this analyst has free now (settled results minus open bets).
    const { available } = axpAccount(records, a.player);
    const lessons = await deps.recall(a.role, `Predicting ${s.teamA} vs ${s.teamB}, a Bo${s.bestOf} at Worlds`).catch((e) => {
      deps.log(`${s.matchId} ${a.player} recall failed, picking without lessons: ${(e as Error).message}`);
      return [] as Lesson[];
    });
    const prompt = buildPickPrompt(a, s, lessons, history, scout);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const reply = await deps.ask(prompt);
        const { text, thinking } = typeof reply === "string" ? { text: reply, thinking: undefined } : reply;
        const pick = parsePick(text, a, s, lessons, deps.now());
        return { ...pick, ...(thinking !== undefined ? { thinking } : {}), ...analystStakes(pick.winProbability, available, s.bestOf) };
      } catch (e) {
        deps.log(`${s.matchId} ${a.player} attempt ${attempt} invalid: ${(e as Error).message}`);
      }
    }
    return null;
  };
  // Either way the picks keep the analysts' order, so the batch has the same shape.
  const picks: (AnalystPick | null)[] = [];
  if (parallel) picks.push(...(await Promise.all(ANALYSTS.map(one))));
  else for (const a of ANALYSTS) picks.push(await one(a));
  return picks.filter((p): p is AnalystPick => p !== null);
}

/** Commits a recorded batch; the record already holds the hash, so a retry re-submits the identical fingerprint. */
async function commitRecord(deps: PickDeps, r: SeriesRecord, out: { committed: string[] }) {
  const count = (JSON.parse(r.batch!) as { entries: unknown[] }).entries.length;
  const commitDigest = await deps.commit(r.series.matchId, r.batchHash!, count);
  await deps.store.put({ ...r, status: "committed", commitDigest, chain: deps.chain });
  deps.log(`${r.series.matchId} ${r.series.teamA} vs ${r.series.teamB}: committed ${count} picks (${commitDigest})`);
  out.committed.push(r.series.matchId);
}

export async function runPick(deps: PickDeps, opts: PickOptions = {}): Promise<{ committed: string[]; missed: string[] }> {
  const { maxNew = Infinity, parallel = false } = opts;
  const out = { committed: [] as string[], missed: [] as string[] };

  // Interrupted commits: re-submit the same hash, or give up honestly once the lock has passed.
  for (const r of (await deps.store.all()).filter((x) => x.status === "committing" && isLocked(x.series.startTime, deps.now()))) {
    await deps.store.put({ ...r, status: "missed" });
    out.missed.push(r.series.matchId);
  }
  for (const r of seriesToResume(viewOf(await deps.store.all()), deps.now())) {
    try {
      await commitRecord(deps, r, out);
    } catch (e) {
      deps.log(`${r.series.matchId} resume failed, will retry: ${(e as Error).message}`);
    }
  }

  const schedule = await deps.fetchSeries();
  const { pick, missed } = seriesToPick(schedule, viewOf(await deps.store.all()), deps.now());
  for (const s of missed) {
    await deps.store.put(emptyRecord(s, "missed"));
    out.missed.push(s.matchId);
  }
  const todo = Number.isFinite(maxNew) ? [...pick].sort((a, b) => a.startTime.localeCompare(b.startTime)).slice(0, maxNew) : pick;
  for (const s of todo) {
    try {
      const scout = deps.scout?.(s.teamA, s.teamB) ?? null;
      const picks = await analystPicks(deps, s, scout, parallel);
      if (picks.length < MIN_ANALYSTS) {
        deps.log(`${s.matchId} only ${picks.length} valid picks; not committing, will retry next run`);
        continue;
      }
      if (isLocked(s.startTime, deps.now())) {
        await deps.store.put(emptyRecord(s, "missed"));
        out.missed.push(s.matchId);
        continue;
      }
      const batch = canonicalBatch(s.matchId, analystEntries(s.bestOf, picks));
      const record: SeriesRecord = { ...emptyRecord(s, "committing"), picks, batch, batchHash: batchHash(batch), ...(scout ? { scout } : {}) };
      await deps.store.put(record); // recorded before the chain call, so a crash resumes with the same hash instead of re-picking
      await commitRecord(deps, record, out);
    } catch (e) {
      deps.log(`${s.matchId} failed: ${(e as Error).message}`);
    }
  }
  return out;
}

/** One line per settled series, oldest first: the results every analyst prompt shows. */
export function historyLines(records: SeriesRecord[]): string[] {
  return records
    .filter((r) => r.status === "settled" && r.result)
    .sort((x, y) => x.series.startTime.localeCompare(y.series.startTime))
    .map((r) => `${r.series.startTime.slice(0, 10)} ${r.series.teamA} vs ${r.series.teamB}: ${r.result!.winner} won ${r.result!.score}`);
}

export async function realPickDeps(store: RecordStore = new Store()): Promise<PickDeps> {
  const { fetchSeries } = await import("../core/worlds.ts");
  const { memory } = await import("../core/memory.ts");
  const { askAnalystFull } = await import("../core/llm.ts");
  const { scoutDigest } = await import("../core/scoutstore.ts");
  const scoutData = await store.readScout();
  // Built right before the stage runs, so it includes everything settled earlier in the same tick.
  const history = historyLines(await store.all());
  const { commitBatch, currentChain } = await import("../core/ledger.ts");
  return {
    fetchSeries,
    store,
    recall: async (role, query) => {
      const ns = `kdace-analyst-${role}`;
      const res = await memory(ns).recall({ query, limit: 8, namespace: ns });
      // Lessons without a timestamp can't be proven to predate a pick, so they are not offered.
      return res.results.flatMap((r) => (r.created_at ? [{ blobId: r.blob_id, text: r.text, createdAt: r.created_at }] : []));
    },
    // Picks get the deepest thinking: each one is fingerprinted and published with its thinking summary.
    ask: (prompt) => askAnalystFull(prompt, "xhigh"),
    // Shares the Referee with the fan lock route; the Supabase mutex keeps their transactions apart.
    commit: (matchId, hash, count) => withRefereeLock(fanDbFromEnv(), "tick", () => commitBatch(matchId, hash, count), { waitMs: 5 * 60_000, proceedIfDbDown: true }),
    chain: currentChain(),
    history: () => history,
    scout: (a, b) => scoutDigest(a, b, scoutData),
    now: () => new Date(),
    log: (msg) => console.log(`[pick] ${msg}`),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await withLock("data", async () => runPick(await realPickDeps()));
  console.log(`[pick] committed ${result.committed.length}, missed ${result.missed.length}`);
  process.exit(0);
}
