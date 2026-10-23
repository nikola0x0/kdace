import { describe, expect, it } from "vitest";
import { AXP_START, computeBoard, marketNet, type SettledSeries } from "../src/core/points.ts";

const w = (player: string, choice: string, stake = 100) => ({ player, market: "winner" as const, choice, stake });
const sc = (player: string, choice: string, stake = 100) => ({ player, market: "score" as const, choice, stake });
const bo1 = (entries: SettledSeries["entries"], winner = "GEN", matchId = "m"): SettledSeries => ({ matchId, bestOf: 1, result: { winner, score: "1-0" }, entries });

describe("marketNet (parimutuel per market)", () => {
  it("pays winners the pool in proportion to their stakes; losers lose their stake", () => {
    expect(marketNet(bo1([w("a", "T1", 100), w("b", "T1", 300), w("c", "GEN", 200)]))).toEqual({ a: -100, b: -300, c: 400 });
  });
  it("floors each payout and drops the leftover dust", () => {
    // pool 400, winning stake 300: a gets floor(133.33) = 133, b floor(266.67) = 266; 1 AXP of dust is dropped
    expect(marketNet(bo1([w("a", "GEN", 100), w("b", "GEN", 200), w("c", "T1", 100)]))).toEqual({ a: 33, b: 66, c: -100 });
  });
  it("refunds everyone when nobody picked the winning outcome", () => {
    expect(marketNet(bo1([w("a", "T1", 100), w("b", "T1", 500)]))).toEqual({ a: 0, b: 0 });
  });
  it("gives net 0 when everyone backed the winner", () => {
    expect(marketNet(bo1([w("a", "GEN", 100), w("b", "GEN", 500)]))).toEqual({ a: 0, b: 0 });
  });
  it("settles the score market separately on Bo3/Bo5 and sums per player", () => {
    const s: SettledSeries = { matchId: "m", bestOf: 5, result: { winner: "GEN", score: "3-1" },
      entries: [w("a", "T1", 1000), w("c", "GEN", 1000), sc("a", "3-1", 100), sc("c", "3-0", 300)] };
    expect(marketNet(s)).toEqual({ a: -1000 + 300, c: 1000 - 300 });
  });
  it("ignores a score market on Bo1", () => {
    expect(marketNet(bo1([w("a", "GEN", 100), w("b", "T1", 100), sc("a", "1-0", 50)]))).toEqual({ a: 100, b: -100 });
  });
  it.each([[-100], [Number.NaN], [1.5]])("refuses to settle a stake of %s", (stake) => {
    expect(() => marketNet(bo1([w("a", "GEN", stake), w("b", "IG")]))).toThrow(/stake/);
  });
});

describe("computeBoard", () => {
  it("starts everyone at 10,000 AXP and ranks by balance, then K, then player", () => {
    // s1: pool 300 over a winning stake of 200, so a and b each get 150 back (+50); s2: c takes the 300 pool (+200)
    const s1 = bo1([w("a", "GEN", 100), w("b", "GEN", 100), w("c", "T1", 100)], "GEN", "1");
    const s2 = bo1([w("a", "TES", 100), w("b", "TES", 100), w("c", "BLG", 100)], "BLG", "2");
    expect(AXP_START).toBe(10000);
    expect(computeBoard([s1, s2])).toEqual([
      { player: "c", balance: 10100, net: 100, k: 1, d: 1, a: 0, bets: 2 },
      { player: "a", balance: 9950, net: -50, k: 1, d: 1, a: 1, bets: 2 },
      { player: "b", balance: 9950, net: -50, k: 1, d: 1, a: 1, bets: 2 },
    ]);
  });
  it("counts score bets on Bo3/Bo5 as bets and KDA", () => {
    const s: SettledSeries = { matchId: "m", bestOf: 3, result: { winner: "GEN", score: "2-1" },
      entries: [w("a", "GEN", 500), w("b", "IG", 500), sc("a", "2-0", 100), sc("b", "2-1", 100)] };
    expect(computeBoard([s])).toEqual([
      { player: "a", balance: 10000 + 500 - 100, net: 400, k: 1, d: 1, a: 0, bets: 2 },
      { player: "b", balance: 10000 - 500 + 100, net: -400, k: 1, d: 1, a: 0, bets: 2 },
    ]);
  });
});
