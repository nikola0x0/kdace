import { describe, expect, it } from "vitest";
import { PLACE_BPS, PRIZE_PLACES, placeBps, prizeSplit, rankForPrizes, splitAmounts } from "../src/core/prizes.ts";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const fans = (n: number) => Array.from({ length: n }, (_, i) => `fan:0x${(i + 1).toString(16)}`);

// Every expected vector here is copied from move/tests/prize_pool_tests.move, so TS and Move agree.
describe("splitAmounts (mirrors prize_pool::split_amounts)", () => {
  it("has 20 places whose basis points sum to 10,000", () => {
    expect(PLACE_BPS).toHaveLength(PRIZE_PLACES);
    expect(sum([...PLACE_BPS])).toBe(10000);
    expect(placeBps(20)).toBe(0);
  });
  it("matches the payout table for a full top 20", () => {
    expect(splitAmounts(1_000_000, 20)).toEqual([
      250_000, 150_000, 100_000, 60_000, 60_000, 36_000, 36_000, 36_000, 36_000, 36_000,
      20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
    ]);
  });
  it("gives rounding dust to 1st", () => {
    const a = splitAmounts(10_007, 20);
    expect(sum(a)).toBe(10_007);
    expect(a[0]).toBe(2_506);
    expect(a[1]).toBe(1_501);
    expect(a[19]).toBe(200);
  });
  it("spreads unpaid shares over the paid places in proportion when fewer than 20 win", () => {
    expect(splitAmounts(1_000, 3)).toEqual([500, 300, 200]);
    expect(splitAmounts(100, 4)).toEqual([47, 26, 17, 10]);
    expect(splitAmounts(12_345, 1)).toEqual([12_345]);
  });
  it("never loses or creates units, including at Number.MAX_SAFE_INTEGER", () => {
    for (const t of [1, 19, 999, 1_000_003, Number.MAX_SAFE_INTEGER]) {
      for (let n = 1; n <= 20; n++) {
        const a = splitAmounts(t, n);
        expect(a).toHaveLength(n);
        expect(sum(a)).toBe(t);
      }
    }
  });
  it("pays nobody with no winners and rejects bad pools", () => {
    expect(splitAmounts(1000, 0)).toEqual([]);
    expect(() => splitAmounts(-1, 3)).toThrow();
    expect(() => splitAmounts(1.5, 3)).toThrow();
  });
});

describe("prizeSplit", () => {
  it("skips AI analysts so the next human moves up", () => {
    const shares = prizeSplit(1_000, ["analyst-mid", "fan:a", "analyst-top", "fan:b", "fan:c"]);
    expect(shares).toEqual([
      { place: 1, player: "fan:a", bps: 2500, amount: 500 },
      { place: 2, player: "fan:b", bps: 1500, amount: 300 },
      { place: 3, player: "fan:c", bps: 1000, amount: 200 },
    ]);
  });
  it("pays only the top 20 humans", () => {
    const shares = prizeSplit(1_000_000, fans(25));
    expect(shares).toHaveLength(20);
    expect(shares[19]).toMatchObject({ place: 20, player: "fan:0x14", amount: 20_000 });
    expect(sum(shares.map((s) => s.amount))).toBe(1_000_000);
  });
  it("returns nothing when no humans are ranked", () => {
    expect(prizeSplit(1_000, ["analyst-adc"])).toEqual([]);
  });
});

describe("rankForPrizes", () => {
  it("orders by Total, then profit, then input order; drops analysts", () => {
    const ranked = rankForPrizes([
      { player: "fan:early", total: 12_000, net: 1_500 },
      { player: "analyst-jungle", total: 99_000, net: 89_000 },
      { player: "fan:late", total: 12_000, net: 1_500 },
      { player: "fan:profit", total: 12_000, net: 2_000 },
      { player: "fan:top", total: 15_000, net: 0 },
    ]);
    expect(ranked).toEqual(["fan:top", "fan:profit", "fan:early", "fan:late"]);
  });
});
