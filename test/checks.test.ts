import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";
import { axpMatches, boardMatches, checkRecord } from "../src/core/checks.ts";
import { computeBoard } from "../src/core/points.ts";
import { Store, type SeriesRecord } from "../src/core/store.ts";

const batch = canonicalBatch("x", [{ player: "analyst-adc", market: "winner", choice: "GEN", stake: 1000 }]);
const hash = batchHash(batch);
const record: SeriesRecord = {
  series: { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "completed", teamA: "GEN", teamB: "IG", winsA: 1, winsB: 0, winner: "GEN" },
  status: "settled", batch, batchHash: hash, commitDigest: "c", debate: "d", lessons: [], axp: { "analyst-adc": 0 },
  result: { winner: "GEN", score: "1-0", resultDigest: "r" },
  picks: [{ player: "analyst-adc", winner: "GEN", score: null, winProbability: 60, reasoning: "r", stake: 1000, pickedAt: "2026-10-23T12:00:00Z", usedLessons: [{ blobId: "b", text: "t", createdAt: "2026-10-22T00:00:00Z" }] }],
};
const commit = { type: "BatchCommitted" as const, json: { market_id: "x", batch_hash: [...Buffer.from(hash, "hex")], committed_at_ms: String(Date.parse("2026-10-23T12:01:00Z")) } };
const result = { type: "ResultPosted" as const, json: { market_id: "x", winner: "GEN", score: "1-0" } };
const official = record.series;

describe("checkRecord", () => {
  it("passes a clean record", () => {
    expect(checkRecord(record, commit, result, official)).toEqual({ hashMatches: true, picksMatchBatch: true, committedBeforeStart: true, resultMatchesOfficial: true, lessonsPredatePicks: true });
  });
  it("accepts a base64 batch_hash", () => {
    expect(checkRecord(record, { ...commit, json: { ...commit.json, batch_hash: Buffer.from(hash, "hex").toString("base64") } }, result, official).hashMatches).toBe(true);
  });
  it("flags a wrong hash", () => {
    expect(checkRecord({ ...record, batch: canonicalBatch("x", []) }, commit, result, official).hashMatches).toBe(false);
  });
  it("flags a commit after the start", () => {
    expect(checkRecord(record, { ...commit, json: { ...commit.json, committed_at_ms: String(Date.parse("2026-10-23T17:05:00Z")) } }, result, official).committedBeforeStart).toBe(false);
  });
  it("flags a wrong winner", () => {
    expect(checkRecord(record, commit, { ...result, json: { ...result.json, winner: "IG" } }, official).resultMatchesOfficial).toBe(false);
  });
  it("flags a lesson created after the pick", () => {
    const late = { ...record, picks: [{ ...record.picks[0], usedLessons: [{ blobId: "b", text: "t", createdAt: "2026-10-23T13:00:00Z" }] }] };
    expect(checkRecord(late, commit, result, official).lessonsPredatePicks).toBe(false);
  });
  it("judges the result against the official feed, not the record's own copy", () => {
    expect(checkRecord(record, commit, result, { ...official, winner: "IG", winsA: 0, winsB: 1 }).resultMatchesOfficial).toBe(false);
    expect(checkRecord(record, commit, result, undefined).resultMatchesOfficial).toBe(false);
  });
  it("rejects a commit or result that belongs to another match", () => {
    expect(checkRecord(record, { ...commit, json: { ...commit.json, market_id: "other" } }, result, official).hashMatches).toBe(false);
    expect(checkRecord(record, commit, { ...result, json: { ...result.json, market_id: "other" } }, official).resultMatchesOfficial).toBe(false);
  });
  it("rejects an event of the wrong type", () => {
    expect(checkRecord(record, { ...result, json: commit.json } as any, result, official).hashMatches).toBe(false);
  });
  it("flags displayed picks that differ from the hashed batch", () => {
    const edited = { ...record, picks: [{ ...record.picks[0], winner: "IG" }] };
    expect(checkRecord(edited, commit, result, official).picksMatchBatch).toBe(false);
  });
  it("flags a displayed stake that differs from the hashed batch", () => {
    expect(checkRecord({ ...record, picks: [{ ...record.picks[0], stake: 2000 }] }, commit, result, official).picksMatchBatch).toBe(false);
  });
  it("fails everything on-chain when the commit is missing", () => {
    expect(checkRecord(record, null, result, official)).toMatchObject({ hashMatches: false, committedBeforeStart: false });
  });
});

describe("axpMatches", () => {
  it("recomputes each player's net from the published batches", () => {
    const two = canonicalBatch("x", [{ player: "analyst-adc", market: "winner", choice: "GEN", stake: 1000 }, { player: "analyst-top", market: "winner", choice: "IG", stake: 500 }]);
    const r = { ...record, batch: two };
    expect(axpMatches({ ...r, axp: { "analyst-adc": 500, "analyst-top": -500 } })).toBe(true);
    expect(axpMatches({ ...r, axp: { "analyst-adc": 1500, "analyst-top": -500 } })).toBe(false);
    expect(axpMatches({ ...r, axp: null })).toBe(false);
  });
});

describe("boardMatches", () => {
  it("detects an edited board", () => {
    const st = new Store(mkdtempSync(join(tmpdir(), "kdace-")));
    st.put(record);
    st.writeBoard(computeBoard([{ matchId: "x", bestOf: 1, entries: JSON.parse(batch).entries, result: { winner: "GEN", score: "1-0" } }]));
    expect(boardMatches(st)).toBe(true);
    st.writeBoard([{ player: "analyst-adc", balance: 99999, net: 89999, k: 1, d: 0, a: 0, bets: 1 }]);
    expect(boardMatches(st)).toBe(false);
  });
});
