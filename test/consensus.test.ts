import { describe, expect, it } from "vitest";
import { aiConsensus } from "../src/core/consensus.ts";

const pick = (winner: string, winProbability: number) => ({ player: "p", winner, score: null, winProbability, reasoning: "", usedLessons: [], pickedAt: "", stake: 100 });

describe("aiConsensus", () => {
  it("averages each analyst's probability for team A", () => {
    expect(aiConsensus([pick("T1", 80), pick("GEN", 60), pick("T1", 70)], "T1")).toBeCloseTo((80 + 40 + 70) / 3);
  });
  it("is null with no picks", () => expect(aiConsensus([], "T1")).toBeNull());
});
