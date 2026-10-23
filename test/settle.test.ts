import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSTS } from "../src/core/analysts.ts";
import { canonicalBatch } from "../src/core/batch.ts";
import { LEGACY_CHAIN } from "../src/core/chain.ts";
import { Store, type SeriesRecord } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";
import { runSettle, runSettleFast, runSettleSlow, type SettleDeps } from "../src/jobs/settle.ts";
import { VOID } from "../src/core/results.ts";

const series: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const done: Series = { ...series, state: "completed", winsA: 1, winsB: 0, winner: "GEN" };
const picks = ANALYSTS.map((a, i) => ({ player: a.player, winner: i < 2 ? "GEN" : "IG", score: null, winProbability: 60, reasoning: "r", usedLessons: [], pickedAt: "2026-10-23T12:00:00Z", stake: 1000 }));
const committed = (): SeriesRecord => ({
  series, status: "committed", picks, batchHash: "h", commitDigest: "d", result: null, axp: null, debate: null, lessons: [],
  batch: canonicalBatch("x", picks.map((p) => ({ player: p.player, market: "winner" as const, choice: p.winner, stake: p.stake }))),
});

function fakes(overrides: Partial<Omit<SettleDeps, "store">> & { store?: Store } = {}) {
  const posted: string[][] = [];
  const remembered: string[] = [];
  const store = new Store(mkdtempSync(join(tmpdir(), "kdace-")));
  store.put(committed());
  const deps: Omit<SettleDeps, "store"> & { store: Store } = {
    fetchSeries: async () => [done],
    store,
    postResult: async (m, w, s) => (posted.push([m, w, s]), "result-digest"),
    ask: async (p) => (p.includes("debate") && p.includes("Write the debate") ? "Top: ...\nJungle: ...\nMid: ...\nADC: ...\nSupport: ..." : "ADC lesson: something."),
    startRemember: async (role, text) => (remembered.push(`${role}:${text}`), `job-${remembered.length}`),
    awaitRemember: async (_role, jobId) => jobId.replace("job", "blob"),
    chain: LEGACY_CHAIN,
    now: () => new Date("2026-10-23T20:00:00Z"),
    log: () => {},
    ...overrides,
  };
  return { deps, posted, remembered, store };
}

describe("runSettle", () => {
  it("posts result, scores, debates and writes one lesson per analyst", async () => {
    const { deps, posted, remembered, store } = fakes();
    await runSettle(deps);
    const r = store.get("x")!;
    expect(posted).toEqual([["x", "GEN", "1-0"]]);
    expect(remembered).toHaveLength(5);
    expect(r.status).toBe("settled");
    expect(r.axp).toEqual({ "analyst-top": 1500, "analyst-jungle": 1500, "analyst-mid": -1000, "analyst-adc": -1000, "analyst-support": -1000 });
    expect(r.debate).toContain("Support:");
    expect(store.readBoard()[0]).toEqual({ player: "analyst-jungle", balance: 11500, net: 1500, k: 1, d: 0, a: 1, bets: 1 });
    expect(store.readBoard().reduce((sum, row) => sum + row.net, 0)).toBe(0);
  });
  it("resumes a timed-out lesson by waiting on the same job instead of writing it again", async () => {
    let waits = 0;
    const first = fakes({ awaitRemember: async (_r, jobId) => { if (++waits === 3) throw new Error("timed out"); return jobId.replace("job", "blob"); } });
    await runSettle(first.deps);
    // The result and AXP settle in the fast part; only the lessons are left for the next run.
    expect(first.store.get("x")!.status).toBe("settled");
    const awaited: string[] = [];
    await runSettle({ ...first.deps, awaitRemember: async (_r, jobId) => (awaited.push(jobId), jobId.replace("job", "blob")) });
    const r = first.store.get("x")!;
    expect(first.remembered).toHaveLength(5);
    expect(awaited).toEqual(["job-3", "job-4", "job-5"]);
    expect(r.lessons.every((l) => l.blobId.startsWith("blob-"))).toBe(true);
    expect(r.status).toBe("settled");
    expect(first.posted).toHaveLength(1);
  });
  it.each([
    ["no winner yet", { winner: null, winsA: 0, winsB: 0 }],
    ["an unfinished score", { winner: "GEN", winsA: 1, winsB: 1, bestOf: 3 as const }],
    ["a winner outside the match", { winner: "T1", winsA: 1, winsB: 0 }],
  ])("does not settle a completed series with %s", async (_n, patch) => {
    const { deps, posted, store } = fakes({ fetchSeries: async () => [{ ...done, ...patch }] });
    await runSettle(deps);
    expect(posted).toEqual([]);
    expect(store.get("x")!.status).toBe("committed");
  });
  it("keeps settling other series when one fails", async () => {
    const { deps, store } = fakes();
    store.put({ ...committed(), series: { ...series, matchId: "y" } });
    await runSettle({ ...deps, fetchSeries: async () => [done, { ...done, matchId: "y" }], postResult: async (m) => { if (m === "x") throw new Error("boom"); return "rd"; } });
    expect(store.get("y")!.status).toBe("settled");
    expect(store.get("x")!.status).toBe("committed");
  });
  it("ignores series not yet completed", async () => {
    const { deps, posted } = fakes({ fetchSeries: async () => [series] });
    await runSettle(deps);
    expect(posted).toEqual([]);
  });

  it("leaves a series committed on another network for that network to settle", async () => {
    const { deps, posted, store } = fakes({ chain: { network: "mainnet", packageId: "0xnew" } });
    await runSettle(deps);
    expect(posted).toEqual([]);
    expect(store.get("x")!.status).toBe("committed");
  });

  it("is resumable when the schedule is down: a posted result still finishes, nothing new is posted", async () => {
    const { deps, posted, store } = fakes({ fetchSeries: async () => { throw new Error("lolesports 503"); } });
    store.put({ ...committed(), series: { ...series, matchId: "y" }, result: { winner: "GEN", score: "1-0", resultDigest: "rd" } });
    await runSettleFast(deps);
    expect(posted).toEqual([]);
    expect(store.get("y")!.status).toBe("settled");
    expect(store.get("x")!.status).toBe("committed");
  });
});

describe("fast and slow settle", () => {
  it("fast: posts the result, settles AXP and writes the board, without asking the LLM", async () => {
    const asked: string[] = [];
    const { deps, posted, store, remembered } = fakes({ ask: async (p) => (asked.push(p), "x") });
    const out = await runSettleFast(deps);
    expect(out).toEqual({ settled: ["x"], voided: [] });
    expect(posted).toEqual([["x", "GEN", "1-0"]]);
    expect(asked).toEqual([]);
    expect(remembered).toEqual([]);
    const r = store.get("x")!;
    expect(r).toMatchObject({ status: "settled", debate: null, lessons: [] });
    expect(r.axp!["analyst-top"]).toBe(1500);
    expect(store.readBoard()).toHaveLength(5);
  });
  it("slow: debates and saves lessons for settled series, never posting again", async () => {
    const { deps, posted, store, remembered } = fakes();
    await runSettleFast(deps);
    const out = await runSettleSlow(deps);
    expect(out).toEqual({ reflected: ["x"] });
    expect(posted).toHaveLength(1);
    expect(remembered).toHaveLength(5);
    expect(store.get("x")!.debate).toContain("Top:");
    expect(await runSettleSlow(deps)).toEqual({ reflected: [] });
    expect(remembered).toHaveLength(5);
  });
  it("finishes a record left mid-settle by the old single-pass job (result and axp saved, status committed)", async () => {
    const { deps, posted, store } = fakes();
    store.put({ ...committed(), result: { winner: "GEN", score: "1-0", resultDigest: "rd" }, axp: { "analyst-top": 1500 } });
    await runSettleFast(deps);
    expect(posted).toEqual([]);
    expect(store.get("x")).toMatchObject({ status: "settled", axp: { "analyst-top": 1500 } });
  });
});

describe("void", () => {
  const fanBatch = canonicalBatch("x:fans", [{ player: "fan:0xa", market: "winner", choice: "IG", stake: 300 }]);
  const withFans = (): SeriesRecord => ({ ...committed(), fans: { status: "committed", batch: fanBatch, batchHash: "fh", pickCount: 1, commitDigest: "fd", committedAt: "t", chain: LEGACY_CHAIN } });
  const late = () => new Date(Date.parse(series.startTime) + 48 * 3600_000 + 1);

  it("voids a series with no official result 48 h after its start: VOID on chain, every stake refunded, no debate", async () => {
    const asked: string[] = [];
    const { deps, posted, store, remembered } = fakes({ fetchSeries: async () => [series], now: late, ask: async (p) => (asked.push(p), "x") });
    store.put(withFans());
    const out = await runSettle(deps);
    expect(out.voided).toEqual(["x"]);
    expect(posted).toEqual([["x", VOID, VOID]]);
    const r = store.get("x")!;
    expect(r.status).toBe("void");
    expect(r.result).toEqual({ winner: VOID, score: VOID, resultDigest: "result-digest" });
    expect(Object.values(r.axp!).every((n) => n === 0)).toBe(true);
    expect(Object.keys(r.axp!).sort()).toEqual([...picks.map((p) => p.player), "fan:0xa"].sort());
    expect(asked).toEqual([]);
    expect(remembered).toEqual([]);
    expect(r.debate).toBeNull();
    expect(store.readBoard()).toEqual([]);
  });
  it("voids a series that vanished from the schedule only after 48 h", async () => {
    const early = fakes({ fetchSeries: async () => [] });
    await runSettle(early.deps);
    expect(early.posted).toEqual([]);
    expect(early.store.get("x")!.status).toBe("committed");
    const { deps, posted, store } = fakes({ fetchSeries: async () => [], now: late });
    await runSettle(deps);
    expect(posted).toEqual([["x", VOID, VOID]]);
    expect(store.get("x")!.status).toBe("void");
  });
  it("never voids because the schedule could not be fetched", async () => {
    const { deps, posted, store } = fakes({ fetchSeries: async () => { throw new Error("down"); }, now: late });
    await runSettle(deps);
    expect(posted).toEqual([]);
    expect(store.get("x")!.status).toBe("committed");
  });
  it("posts VOID once: a failed chain call resumes, a posted VOID is not posted again", async () => {
    let fail = true;
    const { deps, posted, store } = fakes({ fetchSeries: async () => [series], now: late, postResult: async (m, w, s) => { posted.push([m, w, s]); if (fail) { fail = false; throw new Error("rpc"); } return "rd"; } });
    await runSettle(deps);
    expect(store.get("x")!.status).toBe("committed");
    await runSettle(deps);
    await runSettle(deps);
    expect(posted).toHaveLength(2);
    expect(store.get("x")!.status).toBe("void");
  });
  it("voids a series the analysts missed but the fans committed", async () => {
    const { deps, store } = fakes({ fetchSeries: async () => [{ ...series, state: "cancelled" as Series["state"] }] });
    store.put({ ...withFans(), status: "missed", batch: null, batchHash: null, commitDigest: null, picks: [] });
    await runSettle(deps);
    expect(store.get("x")).toMatchObject({ status: "void", axp: { "fan:0xa": 0 } });
  });
});
