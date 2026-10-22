import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSTS } from "../src/core/analysts.ts";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";
import { Store } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";
import { emptyRecord, runPick, type PickDeps } from "../src/jobs/pick.ts";

const series: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 3, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const before = new Date("2026-10-23T12:00:00Z");
const after = new Date("2026-10-23T17:30:00Z");
const good = JSON.stringify({ winner: "GEN", score: "2-1", winProbability: 61, reasoning: "r", usedLessonIds: [] });

function fakes(overrides: Partial<PickDeps> = {}) {
  const commits: string[] = [];
  const deps: PickDeps = {
    fetchSeries: async () => [series],
    store: new Store(mkdtempSync(join(tmpdir(), "kdace-"))),
    recall: async () => [],
    ask: async () => good,
    commit: async (matchId) => (commits.push(matchId), "digest-1"),
    chain: { network: "mainnet", packageId: "0xpkg" },
    history: () => [],
    now: () => before,
    log: () => {},
    ...overrides,
  };
  return { deps, commits };
}

describe("runPick", () => {
  it("gives every analyst the Scout digest for the matchup and keeps it on the record", async () => {
    const prompts: string[] = [];
    const { deps } = fakes({ scout: (a, b) => `Scout: ${a} vs ${b} digest`, ask: async (p) => (prompts.push(p), good) });
    await runPick(deps);
    expect(prompts).toHaveLength(5);
    expect(prompts.every((p) => p.includes("Scout: GEN vs IG digest"))).toBe(true);
    expect(deps.store.get("x")!.scout).toBe("Scout: GEN vs IG digest");
  });

  it("commits one batch for a series with 5 valid picks", async () => {
    const { deps, commits } = fakes();
    await runPick(deps);
    const r = deps.store.get("x")!;
    expect(commits).toEqual(["x"]);
    expect(r.status).toBe("committed");
    expect(r.picks).toHaveLength(5);
    expect(r.batchHash).toBe(batchHash(r.batch!));
    expect(JSON.parse(r.batch!).entries).toHaveLength(10);
  });
  it("skips an analyst after two bad replies and still commits with 4", async () => {
    const { deps } = fakes({ ask: async (p) => (p.includes(ANALYSTS[0].belief) ? "no json" : good) });
    await runPick(deps);
    expect(deps.store.get("x")!.picks.map((p) => p.player)).not.toContain("analyst-top");
    expect(deps.store.get("x")!.picks).toHaveLength(4);
  });
  it("does not commit when fewer than 3 analysts are valid", async () => {
    let n = 0;
    const { deps, commits } = fakes({ ask: async () => (n++ < 6 ? "garbage" : good) });
    await runPick(deps);
    expect(commits).toEqual([]);
    expect(deps.store.get("x")).toBeNull();
  });
  it("writes missed instead of committing if the series started during picking", async () => {
    let calls = 0;
    const { deps, commits } = fakes({ now: () => (calls++ === 0 ? before : after) });
    await runPick(deps);
    expect(commits).toEqual([]);
    expect(deps.store.get("x")!.status).toBe("missed");
  });
  it("records the batch before committing and resumes an interrupted commit with the same hash", async () => {
    const hashes: string[] = [];
    let fail = true;
    const { deps } = fakes({ commit: async (_m, hash) => { hashes.push(hash); if (fail) { fail = false; throw new Error("network blip"); } return "digest-2"; } });
    await runPick(deps);
    expect(deps.store.get("x")!.status).toBe("committing");
    const asked: string[] = [];
    await runPick({ ...deps, ask: async (p) => (asked.push(p), good) });
    expect(asked).toEqual([]);
    expect(hashes).toHaveLength(2);
    expect(hashes[1]).toBe(hashes[0]);
    expect(deps.store.get("x")).toMatchObject({ status: "committed", commitDigest: "digest-2" });
  });
  it("keeps going when one series fails to commit", async () => {
    const second = { ...series, matchId: "y" };
    const { deps } = fakes({ fetchSeries: async () => [series, second], commit: async (m) => { if (m === "x") throw new Error("boom"); return "digest-y"; } });
    await runPick(deps);
    expect(deps.store.get("y")!.status).toBe("committed");
  });
  it("picks without lessons when recall fails", async () => {
    const { deps, commits } = fakes({ recall: async () => { throw new Error("relayer down"); } });
    await runPick(deps);
    expect(commits).toEqual(["x"]);
  });
  it("is idempotent", async () => {
    const { deps, commits } = fakes();
    await runPick(deps);
    await runPick(deps);
    expect(commits).toEqual(["x"]);
  });

  it("stakes from confidence and available AXP, and puts every stake in the batch", async () => {
    const { deps } = fakes();
    await runPick(deps);
    const r = deps.store.get("x")!;
    // p = 61 with 10,000 available: winner 1,100, score 30% of that
    expect(r.picks.every((p) => p.stake === 1100 && p.scoreStake === 330)).toBe(true);
    expect(JSON.parse(r.batch!).entries).toContainEqual({ player: "analyst-top", market: "winner", choice: "GEN", stake: 1100 });
    expect(JSON.parse(r.batch!).entries).toContainEqual({ player: "analyst-top", market: "score", choice: "2-1", stake: 330 });
  });
  it("stakes from what is left after settled results and open bets", async () => {
    const { deps } = fakes();
    const other = (matchId: string) => ({ ...series, matchId, bestOf: 1 as const });
    const batch = (matchId: string, stake: number) => canonicalBatch(matchId, [{ player: "analyst-top", market: "winner", choice: "GEN", stake }]);
    deps.store.put({ ...emptyRecord(other("s"), "settled"), batch: batch("s", 500), commitDigest: "d", axp: { "analyst-top": -2000, "analyst-mid": 1000 } });
    deps.store.put({ ...emptyRecord(other("o"), "committed"), batch: batch("o", 3000), commitDigest: "d" });
    await runPick(deps);
    const picks = deps.store.get("x")!.picks;
    // top: 10,000 − 2,000 − 3,000 open = 5,000 available → 550; mid: 11,000 → 1,210 rounds to 1,210
    expect(picks.find((p) => p.player === "analyst-top")).toMatchObject({ stake: 550, scoreStake: 170 });
    expect(picks.find((p) => p.player === "analyst-mid")).toMatchObject({ stake: 1210, scoreStake: 360 });
  });

  it("stamps the committed record with the network and package it was committed on", async () => {
    const { deps } = fakes();
    await runPick(deps);
    expect(deps.store.get("x")!.chain).toEqual({ network: "mainnet", packageId: "0xpkg" });
  });
});
