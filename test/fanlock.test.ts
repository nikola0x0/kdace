import { describe, expect, it } from "vitest";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";
import { runFanLock, type FanLockDeps } from "../src/core/fanlock.ts";
import type { Series } from "../src/core/worlds.ts";
import { MemoryFanDb } from "./helpers/memory-fandb.ts";

const series: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 3, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const A = "0x" + "a".repeat(64);
const B = "0x" + "b".repeat(64);
const at = (iso: string) => new Date(iso);
const justAfterLock = at("2026-10-23T16:55:30Z");

function fakes(overrides: Partial<FanLockDeps> = {}) {
  const db = new MemoryFanDb();
  const commits: { marketId: string; hash: string; count: number; holder: string | null }[] = [];
  const deps: FanLockDeps = {
    db,
    fetchSeries: async () => [series],
    commit: async (marketId, hash, count) => (commits.push({ marketId, hash, count, holder: db.lockHolder }), `digest-${commits.length}`),
    chain: { network: "testnet", packageId: "0xpkg" },
    now: () => justAfterLock,
    log: () => {},
    ...overrides,
  };
  return { db, deps, commits };
}

async function seed(db: MemoryFanDb) {
  await db.upsertPick({ matchId: "x", address: A, market: "winner", choice: "GEN", stake: 100, updatedAt: "2026-10-23T12:00:00.000Z" });
  await db.upsertPick({ matchId: "x", address: A, market: "score", choice: "2-1", stake: 100, updatedAt: "2026-10-23T12:00:00.000Z" });
  await db.upsertPick({ matchId: "x", address: B, market: "winner", choice: "IG", stake: 100, updatedAt: "2026-10-23T16:54:59.000Z" });
}

const expectedBatch = canonicalBatch("x:fans", [
  { player: `fan:${A}`, market: "winner", choice: "GEN", stake: 100 },
  { player: `fan:${A}`, market: "score", choice: "2-1", stake: 100 },
  { player: `fan:${B}`, market: "winner", choice: "IG", stake: 100 },
]);

describe("runFanLock", () => {
  it("commits the final fan picks under <matchId>:fans and records the commit", async () => {
    const { db, deps, commits } = fakes();
    await seed(db);
    expect(await runFanLock(deps)).toEqual({ committed: ["x"], missed: [] });
    expect(commits).toEqual([{ marketId: "x:fans", hash: batchHash(expectedBatch), count: 3, holder: "fan-lock" }]);
    expect(db.commits.get("x")).toMatchObject({ status: "committed", batch: expectedBatch, batchHash: batchHash(expectedBatch), pickCount: 3, commitDigest: "digest-1", network: "testnet", packageId: "0xpkg", committedAt: justAfterLock.toISOString() });
    expect(db.lockHolder).toBeNull();
  });

  it("waits out the grace period after lock before reading picks", async () => {
    const { db, deps, commits } = fakes({ now: () => at("2026-10-23T16:55:10Z") });
    await seed(db);
    await runFanLock(deps);
    expect(commits).toEqual([]);
  });

  it("leaves out a pick stamped at lock", async () => {
    const { db, deps, commits } = fakes();
    await db.upsertPick({ matchId: "x", address: A, market: "winner", choice: "GEN", stake: 100, updatedAt: "2026-10-23T16:55:00.000Z" });
    await runFanLock(deps);
    expect(commits).toEqual([]);
    expect(db.commits.size).toBe(0);
  });

  it("never commits a match twice", async () => {
    const { db, deps, commits } = fakes();
    await seed(db);
    await runFanLock(deps);
    await runFanLock({ ...deps, now: () => at("2026-10-23T16:57:00Z") });
    expect(commits).toHaveLength(1);
  });

  it("skips a match another run already claimed", async () => {
    const { db, deps, commits } = fakes();
    await seed(db);
    await db.insertCommit({ matchId: "x", status: "committing", batch: expectedBatch, batchHash: batchHash(expectedBatch), pickCount: 3, commitDigest: null, network: "testnet", packageId: "0xpkg", committedAt: null, attemptedAt: justAfterLock.toISOString() });
    await runFanLock(deps);
    expect(commits).toEqual([]);
  });

  it("resumes an interrupted commit with the same hash once it is stale, while the game hasn't started", async () => {
    let fail = true;
    const { db, deps, commits } = fakes({ commit: async (m, hash, count) => { commits.push({ marketId: m, hash, count, holder: null }); if (fail) { fail = false; throw new Error("network blip"); } return "digest-2"; } });
    await seed(db);
    await runFanLock(deps);
    expect(db.commits.get("x")!.status).toBe("committing");
    await runFanLock({ ...deps, now: () => at("2026-10-23T16:56:00Z") }); // 30 s later: not stale yet
    expect(commits).toHaveLength(1);
    await seed(db); // a pick changing in the db after lock must not change the resumed batch
    await db.upsertPick({ matchId: "x", address: B, market: "winner", choice: "GEN", stake: 100, updatedAt: "2026-10-23T16:58:00.000Z" });
    expect(await runFanLock({ ...deps, now: () => at("2026-10-23T16:57:30Z") })).toEqual({ committed: ["x"], missed: [] });
    expect(commits[1].hash).toBe(commits[0].hash);
    expect(db.commits.get("x")).toMatchObject({ status: "committed", commitDigest: "digest-2" });
  });

  it("marks an interrupted commit missed once the game has started", async () => {
    const { db, deps } = fakes({ commit: async () => { throw new Error("down"); } });
    await seed(db);
    await runFanLock(deps);
    expect(await runFanLock({ ...deps, now: () => at("2026-10-23T17:00:00Z") })).toEqual({ committed: [], missed: ["x"] });
    expect(db.commits.get("x")!.status).toBe("missed");
  });

  it("records missed instead of committing when the lock route ran too late", async () => {
    const { db, deps, commits } = fakes({ now: () => at("2026-10-23T17:01:00Z") });
    await seed(db);
    expect(await runFanLock(deps)).toEqual({ committed: [], missed: ["x"] });
    expect(commits).toEqual([]);
    expect(db.commits.get("x")).toMatchObject({ status: "missed", commitDigest: null });
  });

  it("ignores series nobody picked, TBD series and series locked long ago", async () => {
    const { db, deps, commits } = fakes({
      fetchSeries: async () => [series, { ...series, matchId: "tbd", teamA: "TBD" }, { ...series, matchId: "old", startTime: "2026-10-20T17:00:00Z", state: "completed" }],
    });
    await db.upsertPick({ matchId: "old", address: A, market: "winner", choice: "GEN", stake: 100, updatedAt: "2026-10-20T12:00:00.000Z" });
    expect(await runFanLock(deps)).toEqual({ committed: [], missed: [] });
    expect(commits).toEqual([]);
    expect(db.commits.size).toBe(0);
  });
});
