import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBatch } from "../src/core/batch.ts";
import { axpAccount, Store, toSettled, type SeriesRecord } from "../src/core/store.ts";

const record = (matchId: string): SeriesRecord => ({
  series: { matchId, startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null },
  status: "committed", picks: [], batch: "b", batchHash: "h", commitDigest: "d", result: null, axp: null, debate: null, lessons: [],
});

describe("Store", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "kdace-"));
  it("round-trips a record", () => {
    const st = new Store(dir());
    st.put(record("x"));
    expect(st.get("x")).toEqual(record("x"));
    expect(st.get("missing")).toBeNull();
  });
  it("lists all records", () => {
    const st = new Store(dir());
    st.put(record("x"));
    st.put(record("y"));
    expect(st.all().map((r) => r.series.matchId).sort()).toEqual(["x", "y"]);
  });
  it("round-trips the board", () => {
    const st = new Store(dir());
    expect(st.readBoard()).toEqual([]);
    st.writeBoard([{ player: "analyst-adc", balance: 10500, net: 500, k: 1, d: 0, a: 1, bets: 1 }]);
    expect(st.readBoard()).toEqual([{ player: "analyst-adc", balance: 10500, net: 500, k: 1, d: 0, a: 1, bets: 1 }]);
  });
});

describe("toSettled", () => {
  it("keeps each entry's stake", () => {
    const batch = canonicalBatch("x", [{ player: "analyst-adc", market: "winner", choice: "GEN", stake: 700 }]);
    const r = { ...record("x"), batch, status: "settled" as const, result: { winner: "GEN", score: "1-0", resultDigest: "r" } };
    expect(toSettled(r).entries).toEqual([{ player: "analyst-adc", market: "winner", choice: "GEN", stake: 700 }]);
  });
  it("leaves out an analyst batch that never reached the chain", () => {
    const batch = canonicalBatch("x", [{ player: "analyst-adc", market: "winner", choice: "GEN", stake: 700 }]);
    const r = { ...record("x"), batch, commitDigest: null, status: "settled" as const, result: { winner: "GEN", score: "1-0", resultDigest: "r" } };
    expect(toSettled(r).entries).toEqual([]);
  });
});

describe("axpAccount", () => {
  const P = "analyst-top";
  const withBatch = (matchId: string, status: SeriesRecord["status"], stake: number, axp: Record<string, number> | null = null): SeriesRecord => ({
    ...record(matchId), status, axp,
    batch: canonicalBatch(matchId, [{ player: P, market: "winner", choice: "GEN", stake }, { player: "analyst-mid", market: "winner", choice: "IG", stake: 999 }]),
  });
  it("starts at 10,000 AXP", () => expect(axpAccount([], P)).toEqual({ start: 10000, settled: 0, open: 0, available: 10000 }));
  it("adds settled nets and holds back stakes in committed or committing records", () => {
    const records = [
      withBatch("a", "settled", 500, { [P]: 450, "analyst-mid": -999 }),
      withBatch("b", "settled", 300, { [P]: -300 }),
      withBatch("c", "committed", 1000),
      withBatch("d", "committing", 200),
      withBatch("e", "missed", 4000),
    ];
    expect(axpAccount(records, P)).toEqual({ start: 10000, settled: 150, open: 1200, available: 10000 + 150 - 1200 });
  });
  it("counts a committed fan batch as open until the series settles", () => {
    const fanBatch = canonicalBatch("f:fans", [{ player: "fan:0xa", market: "winner", choice: "GEN", stake: 250 }]);
    const r: SeriesRecord = { ...record("f"), status: "missed", batch: null,
      fans: { status: "committed", batch: fanBatch, batchHash: "h", pickCount: 1, commitDigest: "fd", committedAt: "t", chain: { network: "testnet", packageId: "0x1" } } };
    expect(axpAccount([r], "fan:0xa").open).toBe(250);
  });
  it("frees every stake of a void series (all nets 0)", () => {
    const r = { ...withBatch("v", "void", 800, { [P]: 0, "analyst-mid": 0 }), result: { winner: "VOID", score: "VOID", resultDigest: "r" } };
    expect(axpAccount([r], P)).toEqual({ start: 10000, settled: 0, open: 0, available: 10000 });
  });
});
