import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSTS } from "../src/core/analysts.ts";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";
import { checkFinalCall } from "../src/core/checks.ts";
import { buildFinalCallPrompt, finalCallDue, finalCallEntries, finalMarketId, parseFinalCall, winnerPools } from "../src/core/finalcall.ts";
import { axpAccount, Store, toSettled, type SeriesRecord } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";
import { runFinalCall, type FinalCallDeps } from "../src/jobs/finalcall.ts";
import { runSettle } from "../src/jobs/settle.ts";

const START = "2026-10-23T17:00:00Z";
const series: Series = { matchId: "x", startTime: START, block: "Swiss", bestOf: 3, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const chain = { network: "mainnet" as const, packageId: "0xpkg" };
const picks = ANALYSTS.map((a, i) => ({ player: a.player, winner: i < 3 ? "GEN" : "IG", score: i < 3 ? "2-0" : "2-1", winProbability: 60, reasoning: `r${i}`, usedLessons: [], pickedAt: "2026-10-23T09:00:00Z", stake: 1000, scoreStake: 300 }));
const entries = picks.flatMap((p) => [{ player: p.player, market: "winner" as const, choice: p.winner, stake: p.stake }, { player: p.player, market: "score" as const, choice: p.score, stake: p.scoreStake }]);
const batch = canonicalBatch("x", entries);
const committed = (s: Series = series): SeriesRecord => ({ series: s, status: "committed", picks, batch: canonicalBatch(s.matchId, entries), batchHash: batchHash(canonicalBatch(s.matchId, entries)), commitDigest: "d", result: null, axp: null, debate: null, lessons: [], chain });
const min = (n: number) => new Date(Date.parse(START) - n * 60_000);

describe("finalCallDue", () => {
  const due = (r: SeriesRecord, now: Date, schedule: Series[] = [series], records: SeriesRecord[] = [r]) => finalCallDue(r, schedule, records, now).due;
  it("is due from 30 minutes before the start", () => {
    expect(due(committed(), min(31))).toBe(false);
    expect(due(committed(), min(30))).toBe(true);
    expect(due(committed(), min(9))).toBe(true);
  });
  it("is skipped with less than 3 minutes to lock (start − 5 min)", () => {
    expect(due(committed(), min(8))).toBe(false);
    expect(due(committed(), min(1))).toBe(false);
  });
  it("runs at most once per series", () => {
    expect(due({ ...committed(), finalCall: { status: "none", batch: null, batchHash: null, commitDigest: null, calls: [] } }, min(20))).toBe(false);
  });
  it("needs a committed analyst batch", () => {
    expect(due({ ...committed(), status: "missed" }, min(20))).toBe(false);
    expect(due({ ...committed(), status: "committing" }, min(20))).toBe(false);
  });
  it("is due earlier once every earlier series that day is settled", () => {
    const early: Series = { ...series, matchId: "e", startTime: "2026-10-23T13:00:00Z" };
    const r = committed();
    const settled = { ...committed(early), status: "settled" as const };
    expect(due(r, min(180), [early, series], [settled, r])).toBe(true);
    expect(due(r, min(180), [early, series], [{ ...settled, status: "committed" }, r])).toBe(false);
    // An earlier series with no record (never picked) is not settled.
    expect(due(r, min(180), [early, series], [r])).toBe(false);
  });
  it("does not count a series from the day before, and needs at least one earlier series", () => {
    const yesterday: Series = { ...series, matchId: "y", startTime: "2026-10-22T17:00:00Z" };
    expect(due(committed(), min(180), [yesterday, series], [{ ...committed(yesterday), status: "settled" }, committed()])).toBe(false);
    expect(due(committed(), min(180))).toBe(false);
  });
  it("uses the official start when it moved earlier, and skips a series that already started", () => {
    const moved = { ...series, startTime: "2026-10-23T16:30:00Z" };
    expect(due(committed(), min(36), [moved])).toBe(false); // 6 min before the new start: past the margin
    expect(due(committed(), min(20), [{ ...series, state: "inProgress" }])).toBe(false);
  });
});

describe("parseFinalCall", () => {
  const ok = (add: unknown, available = 5000) => parseFinalCall(JSON.stringify({ add, reasoning: "Doubling down." }), available);
  it("accepts 0 and whole amounts from 10 up to what is available", () => {
    expect(ok(0)).toEqual({ add: 0, reasoning: "Doubling down." });
    expect(ok(10).add).toBe(10);
    expect(ok(5000).add).toBe(5000);
  });
  it.each([[-10], [5], [5001], [12.5], ["600"], [null], [Number.NaN]])("rejects add = %s", (add) => {
    expect(() => ok(add)).toThrow();
  });
  it("rejects a reply without JSON", () => expect(() => parseFinalCall("I'll add 600", 5000)).toThrow());
});

describe("final-call prompt and pools", () => {
  it("shows the analyst its pick, reasoning, available AXP, the pools (analysts and fans), multipliers and results", () => {
    const a = ANALYSTS[0];
    const pools = winnerPools(committed(), { GEN: 2000, IG: 0 });
    expect(pools).toEqual({ analysts: { GEN: 3000, IG: 2000 }, fans: { GEN: 2000, IG: 0 } });
    const p = buildFinalCallPrompt(a, series, picks[0], 4200, pools, ["2026-10-22 T1 vs BLG: T1 won 2-1"]);
    expect(p).toContain("GEN");
    expect(p).toContain("r0");
    expect(p).toContain("4,200");
    expect(p).toContain("5,000"); // GEN total
    expect(p).toContain("1.40×"); // 7,000 / 5,000
    expect(p).toContain("3.50×"); // 7,000 / 2,000
    expect(p).toContain("T1 won 2-1");
    expect(p).toMatch(/only add to GEN/i);
    expect(winnerPools(committed(), null).fans).toBeNull();
  });
});

function fakes(overrides: Partial<FinalCallDeps> = {}) {
  const commits: [string, string, number][] = [];
  const store = new Store(mkdtempSync(join(tmpdir(), "kdace-")));
  store.put(committed());
  const deps: FinalCallDeps = {
    fetchSeries: async () => [series],
    store,
    ask: async (p) => JSON.stringify({ add: p.includes("You are the Top analyst") ? 600 : 0, reasoning: "Their early game is cooked." }),
    commit: async (m, h, n) => (commits.push([m, h, n]), "final-digest"),
    chain,
    fanPool: async () => ({ GEN: 500, IG: 1500 }),
    history: () => [],
    now: () => min(20),
    log: () => {},
    ...overrides,
  };
  return { deps, commits, store };
}

describe("runFinalCall", () => {
  it("records the calls and the top-up batch before committing it under <matchId>:final", async () => {
    const { deps, commits, store } = fakes();
    const out = await runFinalCall(deps);
    expect(out.committed).toEqual(["x"]);
    const f = store.get("x")!.finalCall!;
    expect(f.status).toBe("committed");
    expect(f.calls).toHaveLength(5);
    expect(f.calls.find((c) => c.player === "analyst-top")).toMatchObject({ add: 600, reasoning: "Their early game is cooked." });
    expect(JSON.parse(f.batch!)).toEqual({ matchId: "x:final", entries: [{ player: "analyst-top", market: "winner", choice: "GEN", stake: 600 }] });
    expect(f.batchHash).toBe(batchHash(f.batch!));
    expect(commits).toEqual([["x:final", f.batchHash, 1]]);
    expect(f).toMatchObject({ commitDigest: "final-digest", chain });
    expect(finalMarketId("x")).toBe("x:final");
  });
  it("with maxNew, makes one final call per run, soonest first", async () => {
    const later: Series = { ...series, matchId: "w", startTime: "2026-10-23T17:10:00Z" };
    const { deps, store } = fakes({ fetchSeries: async () => [series, later] });
    store.put(committed(later));
    expect((await runFinalCall(deps, { maxNew: 1 })).committed).toEqual(["x"]);
    expect(store.get("w")!.finalCall).toBeUndefined();
    expect((await runFinalCall(deps, { maxNew: 1 })).committed).toEqual(["w"]);
  });
  it("never runs twice for a series", async () => {
    const { deps, commits } = fakes();
    await runFinalCall(deps);
    const asked: string[] = [];
    await runFinalCall({ ...deps, ask: async (p) => (asked.push(p), "{}") });
    expect(asked).toEqual([]);
    expect(commits).toHaveLength(1);
  });
  it("records 'none' with no chain call when nobody adds", async () => {
    const { deps, commits, store } = fakes({ ask: async () => JSON.stringify({ add: 0, reasoning: "Happy where I am." }) });
    await runFinalCall(deps);
    expect(commits).toEqual([]);
    expect(store.get("x")!.finalCall).toMatchObject({ status: "none", batch: null, calls: expect.arrayContaining([expect.objectContaining({ add: 0 })]) });
  });
  it("gives each analyst its available AXP after settled results and open bets", async () => {
    const prompts: string[] = [];
    const { deps } = fakes({ ask: async (p) => (prompts.push(p), JSON.stringify({ add: 0, reasoning: "." })) });
    await runFinalCall(deps);
    // 10,000 − 1,000 − 300 open in this series
    expect(prompts.every((p) => p.includes("8,700"))).toBe(true);
  });
  it("leaves out an invalid reply after two tries (never a stake above what's available)", async () => {
    const { deps, store } = fakes({ ask: async (p) => JSON.stringify({ add: p.includes("You are the Top analyst") ? 999_999 : 0, reasoning: "." }) });
    await runFinalCall(deps);
    expect(store.get("x")!.finalCall!.calls.map((c) => c.player)).not.toContain("analyst-top");
  });
  it("falls back to the analysts-only pool when Supabase is unavailable", async () => {
    const prompts: string[] = [];
    const { deps, store } = fakes({ fanPool: async () => { throw new Error("supabase down"); }, ask: async (p) => (prompts.push(p), JSON.stringify({ add: 0, reasoning: "." })) });
    await runFinalCall(deps);
    expect(store.get("x")!.finalCall!.status).toBe("none");
    expect(prompts[0]).toMatch(/fans' pool isn't available/i);
  });
  it("records 'missed' (no chain call) when the lock passes while the analysts think", async () => {
    let n = 0;
    const { deps, commits, store } = fakes({ now: () => (n++ === 0 ? min(20) : min(4)) });
    await runFinalCall(deps);
    expect(commits).toEqual([]);
    expect(store.get("x")!.finalCall!.status).toBe("missed");
  });
  it("resumes an interrupted commit with the same hash, or gives up after lock", async () => {
    const hashes: string[] = [];
    let fail = true;
    const { deps, store } = fakes({ commit: async (_m, h) => { hashes.push(h); if (fail) { fail = false; throw new Error("rpc"); } return "fd2"; } });
    await runFinalCall(deps);
    expect(store.get("x")!.finalCall!.status).toBe("committing");
    await runFinalCall({ ...deps, ask: async () => { throw new Error("must not ask again"); } });
    expect(hashes).toHaveLength(2);
    expect(hashes[1]).toBe(hashes[0]);
    expect(store.get("x")!.finalCall).toMatchObject({ status: "committed", commitDigest: "fd2" });

    const late = fakes({ commit: async () => { throw new Error("rpc"); } });
    await runFinalCall(late.deps);
    await runFinalCall({ ...late.deps, now: () => min(4) });
    expect(late.store.get("x")!.finalCall!.status).toBe("missed");
  });
  it("skips gracefully when the schedule can't be fetched (still resumes interrupted commits)", async () => {
    const { deps, commits, store } = fakes({ fetchSeries: async () => { throw new Error("lolesports down"); } });
    const out = await runFinalCall(deps);
    expect(out.committed).toEqual([]);
    expect(commits).toEqual([]);
    expect(store.get("x")!.finalCall).toBeUndefined();
  });
});

describe("final-call stakes in AXP", () => {
  const withFinal = (status: "committing" | "committed" | "missed"): SeriesRecord => {
    const fb = canonicalBatch("x:final", [{ player: "analyst-top", market: "winner", choice: "GEN", stake: 600 }]);
    return { ...committed(), finalCall: { status, batch: fb, batchHash: batchHash(fb), commitDigest: status === "committed" ? "fd" : null, chain, calls: [{ player: "analyst-top", add: 600, reasoning: ".", decidedAt: "t" }] } };
  };
  it("holds a top-up as open while committing or committed, not once missed", () => {
    expect(axpAccount([withFinal("committed")], "analyst-top").open).toBe(1900);
    expect(axpAccount([withFinal("committing")], "analyst-top").open).toBe(1900);
    expect(axpAccount([withFinal("missed")], "analyst-top").open).toBe(1300);
  });
  it("settles committed top-ups in the same winner pool", () => {
    expect(toSettled({ ...withFinal("committed"), result: { winner: "GEN", score: "2-0", resultDigest: "r" } }).entries).toContainEqual({ player: "analyst-top", market: "winner", choice: "GEN", stake: 600 });
    expect(toSettled({ ...withFinal("missed"), result: { winner: "GEN", score: "2-0", resultDigest: "r" } }).entries.filter((e) => e.stake === 600)).toEqual([]);
  });
  it("pays out top-ups at settle", async () => {
    const st = new Store(mkdtempSync(join(tmpdir(), "kdace-")));
    st.put(withFinal("committed"));
    await runSettle({
      fetchSeries: async () => [{ ...series, state: "completed", winsA: 2, winsB: 0, winner: "GEN" }], store: st, postResult: async () => "rd",
      ask: async () => "Top: gg", startRemember: async () => "j", awaitRemember: async () => "b", chain, now: () => new Date("2026-10-23T20:00:00Z"), log: () => {},
    });
    // winner pool: GEN 3,000 + 600, IG 2,000 → top gets floor(1,600 × 5,600 / 3,600) − 1,600 = 888 on the winner market
    const r = st.get("x")!;
    expect(r.status).toBe("settled");
    expect(r.axp!["analyst-top"]).toBe(888 + Math.floor((300 * 1500) / 900) - 300);
  });
});

describe("checkFinalCall", () => {
  const fb = canonicalBatch("x:final", [{ player: "analyst-top", market: "winner", choice: "GEN", stake: 600 }]);
  const r: SeriesRecord = { ...committed(), finalCall: { status: "committed", batch: fb, batchHash: batchHash(fb), commitDigest: "fd", chain, calls: [{ player: "analyst-top", add: 600, reasoning: ".", decidedAt: "t" }, { player: "analyst-mid", add: 0, reasoning: ".", decidedAt: "t" }] } };
  const ev = (patch: Record<string, unknown> = {}) => ({ type: "BatchCommitted" as const, json: { market_id: "x:final", batch_hash: [...Buffer.from(batchHash(fb), "hex")], committed_at_ms: String(Date.parse("2026-10-23T16:41:00Z")), ...patch } });
  it("passes a clean final call", () => {
    expect(checkFinalCall(r, ev(), series)).toEqual({ finalHashMatches: true, finalCommittedBeforeStart: true, finalEntriesMatchCalls: true, finalOnOriginalSide: true });
  });
  it("flags a wrong market id, hash, or a commit after the start (stored or moved earlier)", () => {
    expect(checkFinalCall(r, ev({ market_id: "x" }), series).finalHashMatches).toBe(false);
    expect(checkFinalCall(r, ev({ batch_hash: [1, 2, 3] }), series).finalHashMatches).toBe(false);
    expect(checkFinalCall(r, ev({ committed_at_ms: String(Date.parse("2026-10-23T17:01:00Z")) }), series).finalCommittedBeforeStart).toBe(false);
    expect(checkFinalCall(r, ev(), { ...series, startTime: "2026-10-23T16:40:00Z" }).finalCommittedBeforeStart).toBe(false);
    expect(checkFinalCall(r, null, series).finalHashMatches).toBe(false);
  });
  it("flags published calls that differ from the batch", () => {
    const edited = { ...r, finalCall: { ...r.finalCall!, calls: [{ player: "analyst-top", add: 700, reasoning: ".", decidedAt: "t" }] } };
    expect(checkFinalCall(edited, ev(), series).finalEntriesMatchCalls).toBe(false);
  });
  it("flags a top-up on the other side from the analyst's pick", () => {
    const other = canonicalBatch("x:final", [{ player: "analyst-top", market: "winner", choice: "IG", stake: 600 }]);
    const flipped = { ...r, finalCall: { ...r.finalCall!, batch: other, batchHash: batchHash(other) } };
    expect(checkFinalCall(flipped, ev({ batch_hash: [...Buffer.from(batchHash(other), "hex")] }), series).finalOnOriginalSide).toBe(false);
  });
  it("flags a top-up by someone who has no pick, or below the minimum stake", () => {
    const stranger = canonicalBatch("x:final", [{ player: "fan:0xa", market: "winner", choice: "GEN", stake: 600 }]);
    expect(checkFinalCall({ ...r, finalCall: { ...r.finalCall!, batch: stranger } }, ev(), series).finalOnOriginalSide).toBe(false);
    const tiny = canonicalBatch("x:final", [{ player: "analyst-top", market: "winner", choice: "GEN", stake: 5 }]);
    expect(checkFinalCall({ ...r, finalCall: { ...r.finalCall!, batch: tiny } }, ev(), series).finalOnOriginalSide).toBe(false);
  });
});
