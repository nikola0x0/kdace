import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";
import { boardMatches, checkRecord } from "../src/core/checks.ts";
import { computeBoard } from "../src/core/points.ts";
import { Store, type SeriesRecord } from "../src/core/store.ts";

const batch = canonicalBatch("x", [{ player: "analyst-adc", market: "winner", choice: "GEN" }]);
const hash = batchHash(batch);
const record: SeriesRecord = {
  series: { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "completed", teamA: "GEN", teamB: "IG", winsA: 1, winsB: 0, winner: "GEN" },
  status: "settled", batch, batchHash: hash, commitDigest: "c", debate: "d", lessons: [], points: { "analyst-adc": 1000 },
  result: { winner: "GEN", score: "1-0", resultDigest: "r" },
  picks: [{ player: "analyst-adc", winner: "GEN", score: null, winProbability: 60, reasoning: "r", pickedAt: "2026-10-23T12:00:00Z", usedLessons: [{ blobId: "b", text: "t", createdAt: "2026-10-22T00:00:00Z" }] }],
};
const commit = { json: { batch_hash: [...Buffer.from(hash, "hex")], committed_at_ms: String(Date.parse("2026-10-23T12:01:00Z")) } };
const result = { json: { winner: "GEN", score: "1-0" } };

describe("checkRecord", () => {
  it("passes a clean record", () => {
    expect(checkRecord(record, commit, result)).toEqual({ hashMatches: true, committedBeforeStart: true, resultMatchesOfficial: true, lessonsPredatePicks: true });
  });
  it("accepts a base64 batch_hash", () => {
    expect(checkRecord(record, { json: { ...commit.json, batch_hash: Buffer.from(hash, "hex").toString("base64") } }, result).hashMatches).toBe(true);
  });
  it("flags a wrong hash", () => {
    expect(checkRecord({ ...record, batch: canonicalBatch("x", []) }, commit, result).hashMatches).toBe(false);
  });
  it("flags a commit after the start", () => {
    expect(checkRecord(record, { json: { ...commit.json, committed_at_ms: String(Date.parse("2026-10-23T17:05:00Z")) } }, result).committedBeforeStart).toBe(false);
  });
  it("flags a wrong winner", () => {
    expect(checkRecord(record, commit, { json: { winner: "IG", score: "1-0" } }).resultMatchesOfficial).toBe(false);
  });
  it("flags a lesson created after the pick", () => {
    const late = { ...record, picks: [{ ...record.picks[0], usedLessons: [{ blobId: "b", text: "t", createdAt: "2026-10-23T13:00:00Z" }] }] };
    expect(checkRecord(late, commit, result).lessonsPredatePicks).toBe(false);
  });
  it("fails everything on-chain when the commit is missing", () => {
    expect(checkRecord(record, null, result)).toMatchObject({ hashMatches: false, committedBeforeStart: false });
  });
});

describe("boardMatches", () => {
  it("detects an edited board", () => {
    const st = new Store(mkdtempSync(join(tmpdir(), "kdace-")));
    st.put(record);
    st.writeBoard(computeBoard([{ matchId: "x", bestOf: 1, entries: JSON.parse(batch).entries, result: { winner: "GEN", score: "1-0" } }]));
    expect(boardMatches(st)).toBe(true);
    st.writeBoard([{ player: "analyst-adc", points: 9999, k: 1, d: 0, a: 0 }]);
    expect(boardMatches(st)).toBe(false);
  });
});
