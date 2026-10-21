import { describe, expect, it } from "vitest";
import { computeBoard, marketPoints, type SettledSeries } from "../src/core/points.ts";

const w = (player: string, choice: string) => ({ player, market: "winner" as const, choice });
const sc = (player: string, choice: string) => ({ player, market: "score" as const, choice });

describe("points", () => {
  it("splits the pot among correct pickers, rewarding the contrarian", () => {
    const s: SettledSeries = { matchId: "m", bestOf: 5, result: { winner: "GEN", score: "3-1" },
      entries: [w("a", "T1"), w("b", "T1"), w("c", "GEN"), sc("a", "3-1"), sc("c", "3-0")] };
    expect(marketPoints(s)).toEqual({ c: 1000, a: 1000 });
  });
  it("floors uneven splits", () => {
    const s: SettledSeries = { matchId: "m", bestOf: 1, result: { winner: "T1", score: "1-0" }, entries: [w("a", "T1"), w("b", "T1"), w("c", "T1")] };
    expect(marketPoints(s)).toEqual({ a: 333, b: 333, c: 333 });
  });
  it("leaves the pot unawarded when nobody is right, and ignores score on Bo1", () => {
    const s: SettledSeries = { matchId: "m", bestOf: 1, result: { winner: "T1", score: "1-0" }, entries: [w("a", "GEN"), sc("a", "1-0")] };
    expect(marketPoints(s)).toEqual({});
  });
  it("builds KDA and sorts the board", () => {
    const s1: SettledSeries = { matchId: "1", bestOf: 1, result: { winner: "T1", score: "1-0" }, entries: [w("a", "T1"), w("b", "T1"), w("c", "GEN")] };
    const s2: SettledSeries = { matchId: "2", bestOf: 1, result: { winner: "BLG", score: "1-0" }, entries: [w("a", "TES"), w("b", "TES"), w("c", "BLG")] };
    expect(computeBoard([s1, s2])).toEqual([
      { player: "c", points: 1000, k: 1, d: 1, a: 0 },
      { player: "a", points: 500, k: 1, d: 1, a: 1 },
      { player: "b", points: 500, k: 1, d: 1, a: 1 },
    ]);
  });
});
