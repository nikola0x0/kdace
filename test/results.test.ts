import { describe, expect, it } from "vitest";
import { officialResult, settleAction, VOID, VOID_AFTER_MS } from "../src/core/results.ts";
import type { SeriesRecord } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";

const series: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 3, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const done: Series = { ...series, state: "completed", winsA: 2, winsB: 1, winner: "GEN" };
const record: SeriesRecord = { series, status: "committed", picks: [], batch: "b", batchHash: "h", commitDigest: "d", result: null, axp: null, debate: null, lessons: [] };
const at = (iso: string) => new Date(iso);
const start = Date.parse(series.startTime);
const soon = new Date(start + 3 * 3600_000);
const late = new Date(start + VOID_AFTER_MS);

describe("officialResult", () => {
  it("reads a finished series", () => expect(officialResult(done)).toEqual({ winner: "GEN", score: "2-1" }));
  it.each([
    ["no winner", { winner: null }],
    ["an unfinished score", { winsA: 1, winsB: 1 }],
    ["a winner outside the match", { winner: "T1" }],
    ["the loser credited with more wins", { winsA: 1, winsB: 2 }],
  ])("is null with %s", (_n, patch) => expect(officialResult({ ...done, ...patch })).toBeNull());
});

describe("settleAction", () => {
  it("is 48 hours", () => expect(VOID_AFTER_MS).toBe(48 * 3600_000));
  it("settles on the official result", () => expect(settleAction(record, done, true, soon)).toEqual({ kind: "settle", result: { winner: "GEN", score: "2-1" } }));
  it("finishes a result that was already posted, whatever the feed says now", () => {
    const posted = { ...record, result: { winner: "IG", score: "2-0", resultDigest: "r" } };
    expect(settleAction(posted, undefined, false, soon)).toEqual({ kind: "settle", result: { winner: "IG", score: "2-0" } });
    expect(settleAction({ ...record, result: { winner: VOID, score: VOID, resultDigest: "r" } }, done, true, soon).kind).toBe("void");
  });
  it("waits, never voids, when the schedule could not be fetched", () => {
    expect(settleAction(record, undefined, false, late)).toMatchObject({ kind: "wait" });
  });
  it("waits on a completed series without a winner, then voids it after 48 h", () => {
    const noWinner = { ...done, winner: null };
    expect(settleAction(record, noWinner, true, soon)).toMatchObject({ kind: "wait" });
    expect(settleAction(record, noWinner, true, late)).toMatchObject({ kind: "void" });
  });
  it("treats a series missing from the schedule as pending until 48 h after its stored start", () => {
    expect(settleAction(record, undefined, true, soon)).toMatchObject({ kind: "wait" });
    expect(settleAction(record, undefined, true, new Date(late.getTime() - 1))).toMatchObject({ kind: "wait" });
    expect(settleAction(record, undefined, true, late)).toMatchObject({ kind: "void" });
  });
  it("voids a series the schedule marks cancelled", () => {
    expect(settleAction(record, { ...series, state: "cancelled" as Series["state"] }, true, soon)).toMatchObject({ kind: "void" });
  });
  it("counts the 48 h from the new start when the series was postponed", () => {
    const postponed = { ...series, startTime: "2026-10-24T17:00:00Z" };
    expect(settleAction(record, postponed, true, late)).toMatchObject({ kind: "wait" });
    expect(settleAction(record, postponed, true, at("2026-10-26T17:00:00Z"))).toMatchObject({ kind: "void" });
  });
  it("prefers a late official result over voiding", () => {
    expect(settleAction(record, done, true, new Date(start + 100 * 3600_000))).toMatchObject({ kind: "settle" });
  });
});
