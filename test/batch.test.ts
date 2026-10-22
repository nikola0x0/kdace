import { describe, expect, it } from "vitest";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";

const a = { player: "analyst-mid", market: "winner" as const, choice: "T1", stake: 500 };
const b = { player: "analyst-adc", market: "score" as const, choice: "3-1", stake: 150 };
const c = { player: "analyst-adc", market: "winner" as const, choice: "GEN", stake: 500 };

describe("canonicalBatch", () => {
  it("is independent of entry order", () => {
    expect(canonicalBatch("m1", [a, b, c])).toBe(canonicalBatch("m1", [c, a, b]));
  });
  it("sorts by player then market", () => {
    expect(JSON.parse(canonicalBatch("m1", [a, b, c])).entries.map((e: any) => `${e.player}/${e.market}`))
      .toEqual(["analyst-adc/score", "analyst-adc/winner", "analyst-mid/winner"]);
  });
  it("hashes to 64 hex chars and changes when a choice changes", () => {
    const h1 = batchHash(canonicalBatch("m1", [a]));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(batchHash(canonicalBatch("m1", [{ ...a, choice: "GEN" }]))).not.toBe(h1);
  });
  it("covers every stake, in a fixed key order", () => {
    expect(canonicalBatch("m1", [a])).toBe('{"matchId":"m1","entries":[{"player":"analyst-mid","market":"winner","choice":"T1","stake":500}]}');
    expect(batchHash(canonicalBatch("m1", [{ ...a, stake: 501 }]))).not.toBe(batchHash(canonicalBatch("m1", [a])));
  });

  it("orders a player's positions on both sides of a market the same way every time", () => {
    const a = { player: "fan:0x1", market: "winner" as const, choice: "IG", stake: 50 };
    const b = { player: "fan:0x1", market: "winner" as const, choice: "GEN", stake: 100 };
    expect(canonicalBatch("m", [a, b])).toBe(canonicalBatch("m", [b, a]));
  });

  it("includes recalled lessons in an entry only when there are some", () => {
    const withLessons = canonicalBatch("m", [{ player: "analyst-mid", market: "winner", choice: "T1", stake: 700, lessons: ["blobA"] }]);
    const without = canonicalBatch("m", [{ player: "fan:0x1", market: "winner", choice: "T1", stake: 70 }]);
    expect(JSON.parse(withLessons).entries[0].lessons).toEqual(["blobA"]);
    expect(JSON.parse(without).entries[0]).not.toHaveProperty("lessons");
  });
});

