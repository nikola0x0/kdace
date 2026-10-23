import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSTS } from "../src/core/analysts.ts";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";
import { boardMatches, checkFans } from "../src/core/checks.ts";
import type { FanCommitRow } from "../src/core/fandb.ts";
import { seriesToSettle } from "../src/core/select.ts";
import { Store, toSettled, type SeriesRecord } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";
import { fanAddresses, fanSettledNets, mirrorFanCommits, syncFanAxp } from "../src/jobs/fans.ts";
import { MemoryFanDb } from "./helpers/memory-fandb.ts";
import { playerName } from "../src/core/fans.ts";
import { runSettle, type SettleDeps } from "../src/jobs/settle.ts";

const A = "0x" + "a".repeat(64);
const series: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const done: Series = { ...series, state: "completed", winsA: 1, winsB: 0, winner: "GEN" };
const chain = { network: "testnet" as const, packageId: "0xpkg" };
const picks = ANALYSTS.map((a, i) => ({ player: a.player, winner: i < 1 ? "GEN" : "IG", score: null, winProbability: 60, reasoning: "r", usedLessons: [], pickedAt: "2026-10-23T12:00:00Z", stake: 1000 }));
const analystBatch = canonicalBatch("x", picks.map((p) => ({ player: p.player, market: "winner" as const, choice: p.winner, stake: p.stake })));
const committed = (): SeriesRecord => ({ series, status: "committed", picks, batch: analystBatch, batchHash: batchHash(analystBatch), commitDigest: "d", result: null, axp: null, debate: null, lessons: [], chain });
const fanBatch = canonicalBatch("x:fans", [{ player: `fan:${A}`, market: "winner", choice: "GEN", stake: 1000 }]);
const fanRow: FanCommitRow = { matchId: "x", status: "committed", batch: fanBatch, batchHash: batchHash(fanBatch), pickCount: 1, commitDigest: "fd", network: "testnet", packageId: "0xpkg", committedAt: "2026-10-23T16:55:31.000Z", attemptedAt: "2026-10-23T16:55:30.000Z" };
const store = () => new Store(mkdtempSync(join(tmpdir(), "kdace-")));

describe("mirrorFanCommits", () => {
  it("copies a committed fan batch into the series record with its chain stamp", () => {
    const st = store();
    st.put(committed());
    expect(mirrorFanCommits(st, [fanRow], [series])).toEqual(["x"]);
    expect(st.get("x")!.fans).toEqual({ status: "committed", batch: fanBatch, batchHash: batchHash(fanBatch), pickCount: 1, commitDigest: "fd", committedAt: "2026-10-23T16:55:31.000Z", chain });
    expect(st.get("x")!.status).toBe("committed");
  });
  it("creates a record for a series the analysts missed, stamped with the fans' chain", () => {
    const st = store();
    mirrorFanCommits(st, [fanRow], [series]);
    expect(st.get("x")).toMatchObject({ status: "missed", picks: [], batch: null, chain, fans: { status: "committed" } });
  });
  it("skips in-flight commits, unchanged records and settled records", () => {
    const st = store();
    st.put(committed());
    expect(mirrorFanCommits(st, [{ ...fanRow, status: "committing", commitDigest: null }], [series])).toEqual([]);
    expect(st.get("x")!.fans).toBeUndefined();
    mirrorFanCommits(st, [fanRow], [series]);
    expect(mirrorFanCommits(st, [fanRow], [series])).toEqual([]);
    st.put({ ...committed(), status: "settled" });
    expect(mirrorFanCommits(st, [fanRow], [series])).toEqual([]);
    expect(st.get("x")!.fans).toBeUndefined();
  });
});

describe("toSettled with fans", () => {
  it("merges analyst and committed fan entries, ignoring missed fan batches", () => {
    const r = { ...committed(), result: { winner: "GEN", score: "1-0", resultDigest: "r" }, fans: { status: "committed" as const, batch: fanBatch, batchHash: "h", pickCount: 1, commitDigest: "fd", committedAt: "t", chain } };
    expect(toSettled(r).entries).toHaveLength(6);
    expect(toSettled({ ...r, fans: { ...r.fans, status: "missed" } }).entries).toHaveLength(5);
    expect(toSettled({ ...r, batch: null }).entries).toEqual([{ player: `fan:${A}`, market: "winner", choice: "GEN", stake: 1000 }]);
  });
});

describe("seriesToSettle with fans", () => {
  it("settles a missed series when fans committed", () => {
    const st = store();
    mirrorFanCommits(st, [fanRow], [series]);
    expect(seriesToSettle([done], st).map((s) => s.matchId)).toEqual(["x"]);
    st.put({ ...st.get("x")!, fans: { ...st.get("x")!.fans!, status: "missed" } });
    expect(seriesToSettle([done], st)).toEqual([]);
  });
});

function settleDeps(st: Store, asked: string[]): SettleDeps {
  return {
    fetchSeries: async () => [done], store: st, postResult: async () => "result-digest",
    ask: async (p) => (asked.push(p), p.includes("Write the debate") ? "Top: gg" : "Top lesson: x."),
    startRemember: async () => "job", awaitRemember: async () => "blob", chain, now: () => new Date("2026-10-23T20:00:00Z"), log: () => {},
  };
}

describe("runSettle with fans", () => {
  it("splits each pool between the analysts and fans who called it", async () => {
    const st = store();
    st.put(committed());
    mirrorFanCommits(st, [fanRow], [series]);
    await runSettle(settleDeps(st, []));
    expect(st.get("x")!.axp).toEqual({ "analyst-top": 2000, "analyst-jungle": -1000, "analyst-mid": -1000, "analyst-adc": -1000, "analyst-support": -1000, [`fan:${A}`]: 2000 });
    expect(st.readBoard().map((r) => r.player)).toContain(`fan:${A}`);
    expect(boardMatches(st)).toBe(true);
  });
  it("settles a fans-only series without a debate or lessons", async () => {
    const st = store();
    mirrorFanCommits(st, [fanRow], [series]);
    const asked: string[] = [];
    await runSettle(settleDeps(st, asked));
    expect(asked).toEqual([]);
    expect(st.get("x")).toMatchObject({ status: "settled", axp: { [`fan:${A}`]: 0 }, lessons: [] });
  });
});

describe("syncFanAxp", () => {
  it("writes each fan's settled net to Supabase, then stamps the settled fan commits", async () => {
    const st = store();
    st.put(committed());
    const db = new MemoryFanDb();
    await db.insertCommit(fanRow);
    await db.insertCommit({ ...fanRow, matchId: "late" }); // a series still waiting for its result
    mirrorFanCommits(st, [fanRow], [series]);
    await runSettle(settleDeps(st, []));
    st.put({ ...st.get("x")!, series: { ...series, matchId: "x2" }, axp: { [`fan:${A}`]: -500 } }); // a second settled series
    expect(fanSettledNets(st)).toEqual({ [A]: 1500 });
    expect(await syncFanAxp(st, db, new Date("2026-10-23T20:00:00Z"))).toEqual({ fans: 1, settledCommits: ["x"] });
    expect((await db.getFan(A))!.axpSettled).toBe(1500);
    // Per-series results for claiming: the win on x waits for a claim; the loss on x2 counts straight away.
    expect(await db.results(A)).toEqual([
      { matchId: "x", address: A, stake: 1000, net: 2000, claimedAt: null },
      { matchId: "x2", address: A, stake: 1000, net: -500, claimedAt: null },
    ]);
    expect(db.commits.get("x")!.settledAt).toBe("2026-10-23T20:00:00.000Z");
    expect(db.commits.get("late")!.settledAt).toBeUndefined();
    expect((await syncFanAxp(st, db, new Date("2026-10-23T20:30:00Z"))).settledCommits).toEqual([]);
  });
});

describe("fan names", () => {
  it("lists the fans who appear in published batches and stores their names for the static site", () => {
    const st = store();
    mirrorFanCommits(st, [fanRow], [series]);
    expect(fanAddresses(st)).toEqual([A]);
    st.writeFanNames({ [A]: "nikola.sui" });
    expect(st.readFanNames()).toEqual({ [A]: "nikola.sui" });
    expect(playerName(`fan:${A}`, st.readFanNames())).toBe("nikola.sui");
    expect(playerName(`fan:${"0x" + "c".repeat(64)}`, {})).toBe("0xcccc…cccc");
    expect(playerName("analyst-mid", {})).toBe("Mid");
  });
});

describe("checkFans", () => {
  const r = { ...committed(), fans: { status: "committed" as const, batch: fanBatch, batchHash: batchHash(fanBatch), pickCount: 1, commitDigest: "fd", committedAt: "t", chain } };
  const commit = { type: "BatchCommitted" as const, json: { market_id: "x:fans", batch_hash: [...Buffer.from(batchHash(fanBatch), "hex")], committed_at_ms: String(Date.parse("2026-10-23T16:55:31Z")) } };
  it("passes a clean fan commit", () => {
    expect(checkFans(r, commit, series)).toEqual({ fanHashMatches: true, fanEntriesAreFans: true, fanCommittedBeforeStart: true });
  });
  it("flags a commit for the analysts' market id, a wrong hash, a late commit and non-fan entries", () => {
    expect(checkFans(r, { ...commit, json: { ...commit.json, market_id: "x" } }, series).fanHashMatches).toBe(false);
    expect(checkFans({ ...r, fans: { ...r.fans, batch: canonicalBatch("x:fans", []) } }, commit, series).fanHashMatches).toBe(false);
    expect(checkFans(r, { ...commit, json: { ...commit.json, committed_at_ms: String(Date.parse("2026-10-23T17:00:01Z")) } }, series).fanCommittedBeforeStart).toBe(false);
    const sneaky = canonicalBatch("x:fans", [{ player: "analyst-top", market: "winner", choice: "GEN", stake: 1000 }]);
    expect(checkFans({ ...r, fans: { ...r.fans, batch: sneaky, batchHash: batchHash(sneaky) } }, commit, series).fanEntriesAreFans).toBe(false);
    expect(checkFans(r, null, series)).toMatchObject({ fanHashMatches: false, fanCommittedBeforeStart: false });
  });
});

describe("void series and the fans", () => {
  const voided = (): SeriesRecord => ({ ...committed(), status: "void", fans: { status: "committed", batch: fanBatch, batchHash: batchHash(fanBatch), pickCount: 1, commitDigest: "fd", committedAt: "t", chain }, result: { winner: "VOID", score: "VOID", resultDigest: "r" }, axp: Object.fromEntries([...picks.map((p) => [p.player, 0]), [`fan:${A}`, 0]]) });
  it("writes a net-0 result row (nothing to claim) and frees the fan commit", async () => {
    const st = store();
    st.put(voided());
    const db = new MemoryFanDb();
    db.commits.set("x", { ...fanRow });
    const out = await syncFanAxp(st, db, new Date("2026-10-26T00:00:00Z"));
    expect(out.settledCommits).toEqual(["x"]);
    expect(await db.results(A)).toEqual([{ matchId: "x", address: A, stake: 1000, net: 0, claimedAt: null }]);
    expect(await db.results()).toEqual([]); // no unclaimed win
    expect(fanSettledNets(st)).toEqual({ [A]: 0 });
  });
  it("does not mirror a fan batch onto a series that was already voided", () => {
    const st = store();
    st.put({ ...voided(), fans: undefined });
    expect(mirrorFanCommits(st, [fanRow], [series])).toEqual([]);
  });
});
