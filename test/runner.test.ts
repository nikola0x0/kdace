import { describe, expect, it } from "vitest";
import { ANALYSTS } from "../src/core/analysts.ts";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";
import type { FanCommitRow } from "../src/core/fandb.ts";
import { computeBoard } from "../src/core/points.ts";
import { MemoryStore, toSettled, type SeriesRecord } from "../src/core/store.ts";
import type { RunnerDb, StageState } from "../src/core/supastore.ts";
import type { Series } from "../src/core/worlds.ts";
import { drain, runOnce, stagesWithWork, STAGES, type RunnerDeps, type Stage, type StageFns, type StageOutcome, type WorkView } from "../src/jobs/runner.ts";
import { MemoryFanDb } from "./helpers/memory-fandb.ts";

const START = "2026-10-23T17:00:00Z";
const chain = { network: "mainnet" as const, packageId: "0xpkg" };
const s = (matchId: string, over: Partial<Series> = {}): Series => ({ matchId, startTime: START, block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null, ...over });
const picks = ANALYSTS.map((a, i) => ({ player: a.player, winner: i < 3 ? "GEN" : "IG", score: null, winProbability: 60, reasoning: "r", usedLessons: [], pickedAt: "2026-10-23T09:00:00Z", stake: 1000 }));
const committed = (matchId: string, over: Partial<SeriesRecord> = {}): SeriesRecord => {
  const batch = canonicalBatch(matchId, picks.map((p) => ({ player: p.player, market: "winner" as const, choice: p.winner, stake: p.stake })));
  return { series: s(matchId), status: "committed", picks, batch, batchHash: batchHash(batch), commitDigest: "d", result: null, axp: null, debate: null, lessons: [], chain, banter: { comments: [], at: "t" }, ...over };
};
const at = (iso: string) => new Date(iso);
const noon = at("2026-10-23T12:00:00Z");

class MemoryRunnerDb implements RunnerDb {
  holder: string | null = null;
  state: Record<string, StageState> = {};
  releases = 0;
  async acquireRunnerLock(holder: string) {
    if (this.holder && this.holder !== holder) return false;
    this.holder = holder;
    return true;
  }
  async releaseRunnerLock(holder: string) {
    this.releases++;
    if (this.holder === holder) this.holder = null;
  }
  async readState() {
    return JSON.parse(JSON.stringify(this.state));
  }
  async writeState(stage: string, st: StageState) {
    this.state[stage] = st;
  }
}

/** A view where nothing is due: one committed series hours away, banter done, board current, Scout and titles fresh. */
const quiet = (over: Partial<WorkView> = {}): WorkView => ({
  records: [committed("x")],
  board: [],
  todayTitle: { date: "2026-10-23", status: "committed", picks: [], batch: "b", batchHash: "h", commitDigest: "d" },
  graveyard: {},
  schedule: [s("x")],
  fanCommits: [],
  hasFanDb: false,
  state: { scout: { nextAt: "2026-10-23T23:00:00Z", lastAt: "2026-10-23T11:50:00Z", note: null } },
  chain,
  now: noon,
  ...over,
});
const stages = (v: WorkView) => stagesWithWork(v).map((w) => w.stage);

describe("stagesWithWork", () => {
  it("finds nothing to do on a quiet minute", () => expect(stages(quiet())).toEqual([]));

  it("settles when a committed series' official result is in, or a fan batch is ready to mirror, or the board is stale", () => {
    expect(stages(quiet({ schedule: [s("x", { state: "completed", winsA: 1, winner: "GEN" })] }))).toEqual(["settle"]);
    const fanBatch = canonicalBatch("x:fans", [{ player: `fan:0x${"a".repeat(64)}`, market: "winner", choice: "GEN", stake: 100 }]);
    const row: FanCommitRow = { matchId: "x", status: "committed", batch: fanBatch, batchHash: batchHash(fanBatch), pickCount: 1, commitDigest: "fd", network: "mainnet", packageId: "0xpkg", committedAt: "t", attemptedAt: "t" };
    expect(stages(quiet({ fanCommits: [row] }))).toEqual(["settle"]);
    const settled = committed("y", { status: "settled", result: { winner: "GEN", score: "1-0", resultDigest: "r" }, axp: {}, debate: "d", lessons: picks.map((p) => ({ player: p.player, text: "t", blobId: "b" })) });
    expect(stages(quiet({ records: [committed("x"), settled] }))).toEqual(["settle"]);
    expect(stages(quiet({ records: [committed("x"), settled], board: computeBoard([toSettled(settled)]) }))).toEqual([]);
  });

  it("refreshes fan names every 30 minutes when there is a fan database", () => {
    expect(stages(quiet({ hasFanDb: true }))).toEqual(["settle"]);
    expect(stages(quiet({ hasFanDb: true, state: { ...quiet().state, names: { nextAt: null, lastAt: "2026-10-23T11:45:00Z", note: null } } }))).toEqual([]);
  });

  it("asks for the final call 30 minutes before the start, before any pick", () => {
    const v = quiet({ now: at("2026-10-23T16:35:00Z"), schedule: [s("x"), s("z", { startTime: "2026-10-23T20:00:00Z" })] });
    expect(stages(v)).toEqual(["final", "pick"]);
  });

  it("picks open series, resumes interrupted commits and records missed ones", () => {
    expect(stages(quiet({ schedule: [s("x"), s("z", { startTime: "2026-10-23T20:00:00Z" })] }))).toEqual(["pick"]);
    expect(stages(quiet({ records: [committed("x", { status: "committing", commitDigest: null })] }))).toEqual(["pick"]);
    expect(stages(quiet({ schedule: [s("x"), s("z", { startTime: "2026-10-23T11:00:00Z" })] }))).toEqual(["pick"]);
    expect(stages(quiet({ schedule: [s("x"), s("t", { teamA: "TBD" })] }))).toEqual([]);
  });

  it("refreshes Scout when its time comes, and title calls until the day's are committed", () => {
    expect(stages(quiet({ state: {} }))).toEqual(["scout"]);
    expect(stages(quiet({ todayTitle: null }))).toEqual(["titles"]);
  });

  it("writes banter for a split series before lock, and the debate and lessons of a settled one", () => {
    expect(stages(quiet({ records: [committed("x", { banter: undefined })] }))).toEqual(["banter"]);
    const settled = committed("y", { status: "settled", result: { winner: "GEN", score: "1-0", resultDigest: "r" }, axp: {} });
    expect(stages(quiet({ records: [committed("x"), settled], board: computeBoard([toSettled(settled)]) }))).toEqual(["lessons"]);
  });

  it("skips a stage that is backing off", () => {
    const v = quiet({ schedule: [s("x"), s("z", { startTime: "2026-10-23T20:00:00Z" })], state: { ...quiet().state, pick: { nextAt: "2026-10-23T12:03:00Z", lastAt: "t", note: "no progress" } } });
    expect(stages(v)).toEqual([]);
    expect(stages({ ...v, now: at("2026-10-23T12:03:00Z") })).toEqual(["pick"]);
  });

  it("doesn't settle or final-call a series committed on another network", () => {
    const other = committed("x", { chain: { network: "testnet", packageId: "0xold" } });
    expect(stages(quiet({ records: [other], schedule: [s("x", { state: "completed", winsA: 1, winner: "GEN" })] }))).toEqual([]);
  });
});

function harness(opts: { records?: SeriesRecord[]; schedule?: Series[]; outcomes?: Partial<Record<Stage, (n: number) => StageOutcome | Promise<StageOutcome>>>; budgetMs?: number; clockStepMs?: number } = {}) {
  const store = new MemoryStore();
  for (const r of opts.records ?? [committed("x")]) store.put(r);
  store.putTitleDay({ date: "2026-10-23", status: "committed", picks: [], batch: "b", batchHash: "h", commitDigest: "d" });
  const db = new MemoryRunnerDb();
  db.state.scout = { nextAt: "2026-10-23T13:00:00Z", lastAt: null, note: null };
  const calls: Stage[] = [];
  let clock = noon.getTime();
  const fns = Object.fromEntries(
    STAGES.map((stage) => [stage, async () => {
      calls.push(stage);
      clock += opts.clockStepMs ?? 0;
      const f = opts.outcomes?.[stage];
      return f ? f(calls.filter((c) => c === stage).length) : { progressed: true, detail: null };
    }]),
  ) as unknown as StageFns;
  const deps: RunnerDeps = {
    store, db, fanDb: null, chain, stages: fns, budgetMs: opts.budgetMs ?? 270_000,
    fetchSeries: async () => opts.schedule ?? [s("x")],
    now: () => new Date(clock),
    log: () => {},
  };
  return { deps, db, store, calls, advance: (ms: number) => (clock += ms) };
}

describe("runOnce", () => {
  it("exits fast when there is nothing to do, releasing the lock", async () => {
    const { deps, db, calls } = harness();
    expect(await runOnce(deps, "v1")).toEqual({ busy: false, ran: [], idle: true, pending: [] });
    expect(calls).toEqual([]);
    expect(db.holder).toBeNull();
  });

  it("does nothing while another runner holds the lock", async () => {
    const { deps, db, calls } = harness({ schedule: [s("x"), s("z", { startTime: "2026-10-23T20:00:00Z" })] });
    db.holder = "github:1";
    expect((await runOnce(deps, "v1")).busy).toBe(true);
    expect(calls).toEqual([]);
    expect(db.holder).toBe("github:1");
  });

  it("runs settle, then exactly one heavy stage, and reports what is still pending", async () => {
    const { deps, calls } = harness({
      schedule: [s("x", { state: "completed", winsA: 1, winner: "GEN" }), s("z", { startTime: "2026-10-23T20:00:00Z" })],
      records: [committed("x"), committed("y", { status: "settled", result: { winner: "GEN", score: "1-0", resultDigest: "r" }, axp: {} })],
      outcomes: { settle: () => ({ progressed: true, detail: null }) },
    });
    const out = await runOnce(deps, "v1");
    expect(calls).toEqual(["settle", "pick"]);
    expect(out.pending).toEqual(["lessons"]);
    expect(out.idle).toBe(false);
  });

  it("doesn't start a heavy stage without enough time left; the next call does it", async () => {
    const { deps, calls } = harness({
      schedule: [s("x", { state: "completed", winsA: 1, winner: "GEN" }), s("z", { startTime: "2026-10-23T20:00:00Z" })],
      clockStepMs: 100_000,
    });
    const out = await runOnce(deps, "v1");
    expect(calls).toEqual(["settle"]);
    expect(out.ran[1]).toMatchObject({ stage: "pick", skipped: expect.stringContaining("next call") });
  });

  it("backs a stage off after a run without progress, and after a failure, always releasing the lock", async () => {
    const { deps, db, calls, advance } = harness({
      schedule: [s("x"), s("z", { startTime: "2026-10-23T20:00:00Z" })],
      outcomes: { pick: (n) => (n === 1 ? { progressed: false, detail: "2 valid picks" } : Promise.reject(new Error("anthropic down"))) },
    });
    await runOnce(deps, "v1");
    expect(db.state.pick.nextAt).toBe("2026-10-23T12:05:00.000Z");
    expect((await runOnce(deps, "v1")).idle).toBe(true);
    advance(5 * 60_000);
    const out = await runOnce(deps, "v1");
    expect(out.ran[0]).toMatchObject({ stage: "pick", error: "anthropic down" });
    expect(db.state.pick.note).toContain("anthropic down");
    expect(calls).toEqual(["pick", "pick"]);
    expect(db.holder).toBeNull();
    expect(db.releases).toBe(3);
  });

  it("lets a stage choose when it runs next (Scout: 30 minutes after a full run, a minute after a partial one)", async () => {
    const { deps, db } = harness({ outcomes: { scout: (n) => ({ progressed: true, detail: null, retryInMs: n === 1 ? 60_000 : 30 * 60_000 }) } });
    delete db.state.scout;
    await runOnce(deps, "v1");
    expect(db.state.scout.nextAt).toBe("2026-10-23T12:01:00.000Z");
  });

  it("fails fast without touching anything when the store can't be read", async () => {
    const { deps, db, calls } = harness();
    deps.store.all = async () => {
      throw new Error("Supabase GET series_records HTTP 503");
    };
    await expect(runOnce(deps, "v1")).rejects.toThrow(/503/);
    expect(calls).toEqual([]);
    expect(db.holder).toBeNull();
  });

  it("still finds work when lolesports is down (interrupted commits), and settles nothing new", async () => {
    const { deps, calls } = harness({ records: [committed("x", { status: "committing", commitDigest: null })] });
    deps.fetchSeries = async () => {
      throw new Error("lolesports 502");
    };
    await runOnce(deps, "v1");
    expect(calls).toEqual(["pick"]);
  });
});

describe("drain", () => {
  it("calls runOnce until idle (the GitHub tick in supabase mode)", async () => {
    let picked = false;
    const h = harness({ schedule: [s("x"), s("z", { startTime: "2026-10-23T20:00:00Z" })] });
    h.deps.stages.pick = async () => {
      h.calls.push("pick");
      h.store.put(committed("z", { series: s("z", { startTime: "2026-10-23T20:00:00Z" }) }));
      picked = true;
      return { progressed: true, detail: null };
    };
    expect(await drain(h.deps, "github:1", 60_000)).toEqual({ runs: 2, stopped: "idle" });
    expect(picked).toBe(true);
  });

  it("stops when another runner holds the lock", async () => {
    const h = harness();
    h.db.holder = "vercel";
    expect(await drain(h.deps, "github:1", 60_000)).toEqual({ runs: 1, stopped: "busy" });
  });
});
