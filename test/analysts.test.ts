import { describe, expect, it } from "vitest";
import { analystEntries, analystStakes, ANALYSTS, buildPickPrompt, buildReflectPrompt, parsePick } from "../src/core/analysts.ts";
import type { Series } from "../src/core/worlds.ts";

const bo5: Series = { matchId: "m", startTime: "2026-11-03T22:00:00Z", block: "Quarterfinals", bestOf: 5, state: "unstarted", teamA: "T1", teamB: "GEN", winsA: null, winsB: null, winner: null };
const bo1: Series = { ...bo5, bestOf: 1 };
const adc = ANALYSTS.find((a) => a.role === "adc")!;
const lessons = [{ blobId: "blobA", text: "ADC lesson: weigh opponent strength.", createdAt: "2026-10-20T00:00:00Z" }];
const now = new Date("2026-11-03T12:00:00Z");
const reply = (o: object) => `Sure: ${JSON.stringify(o)}`;

describe("analysts", () => {
  it("has five roles in order", () => expect(ANALYSTS.map((a) => a.role)).toEqual(["top", "jungle", "mid", "adc", "support"]));
  it("prompt carries belief, lessons, teams and contract", () => {
    const p = buildPickPrompt(adc, bo5, lessons, []);
    for (const s of [adc.belief, "[blobA]", "T1", "GEN", "best of 5", "(none yet)", "usedLessonIds"]) expect(p).toContain(s);
  });
  it("parses a valid pick and links used lessons", () => {
    const pick = parsePick(reply({ winner: "GEN", score: "3-1", winProbability: 64, reasoning: "r", usedLessonIds: ["blobA", "nope"] }), adc, bo5, lessons, now);
    expect(pick).toMatchObject({ player: "analyst-adc", winner: "GEN", score: "3-1", winProbability: 64, pickedAt: now.toISOString() });
    expect(pick.usedLessons.map((l) => l.blobId)).toEqual(["blobA"]);
  });
  it("accepts a null score on Bo1", () => {
    const pick = parsePick(reply({ winner: "T1", score: null, winProbability: 55, reasoning: "r", usedLessonIds: [] }), adc, bo1, lessons, now);
    expect(pick.score).toBeNull();
  });
  it.each([
    ["unknown team", { winner: "BLG", score: "3-1", winProbability: 60 }, bo5],
    ["impossible score", { winner: "T1", score: "2-1", winProbability: 60 }, bo5],
    ["score on Bo1", { winner: "T1", score: "1-0", winProbability: 60 }, bo1],
    ["probability below 50", { winner: "T1", score: "3-0", winProbability: 40 }, bo5],
  ])("rejects %s", (_n, body, s) => {
    expect(() => parsePick(reply({ ...body, reasoning: "r", usedLessonIds: [] }), adc, s, lessons, now)).toThrow();
  });
  it("rejects a reply with no JSON", () => expect(() => parsePick("I think T1", adc, bo5, lessons, now)).toThrow());
  it("reflect prompt asks for one lesson through the analyst's belief", () => {
    const pick = { ...parsePick(reply({ winner: "GEN", score: "3-1", winProbability: 64, reasoning: "r", usedLessonIds: [] }), adc, bo5, lessons, now), stake: 1400 };
    const p = buildReflectPrompt(adc, bo5, pick, { winner: "T1", score: "3-2" }, "Top: told you.");
    for (const s of [adc.belief, `${adc.name} lesson:`, "T1", "3-2", "Top: told you."]) expect(p).toContain(s);
  });
});

describe("analyst stakes", () => {
  it("stakes available × (p − 50) / 100 on the winner, rounded to 10, and 30% of that on the score", () => {
    expect(analystStakes(64, 10000, 5)).toEqual({ stake: 1400, scoreStake: 420 });
    expect(analystStakes(57, 3333, 3)).toEqual({ stake: 230, scoreStake: 70 });
    expect(analystStakes(100, 10000, 3)).toEqual({ stake: 5000, scoreStake: 1500 });
  });
  it("stakes at least 100 on the winner, and no score stake on Bo1", () => {
    expect(analystStakes(50, 10000, 1)).toEqual({ stake: 100 });
    expect(analystStakes(51, 10000, 3)).toEqual({ stake: 100, scoreStake: 30 });
  });
  it("never stakes more than is available, and sits out below the 10 AXP minimum", () => {
    expect(analystStakes(80, 80, 3)).toEqual({ stake: 80 });
    expect(analystStakes(50, 120, 3)).toEqual({ stake: 100, scoreStake: 20 });
    expect(analystStakes(50, 105, 3)).toEqual({ stake: 100 });
    expect(analystStakes(90, 9, 3)).toEqual({ stake: 0 });
  });
  it("turns picks into batch entries with their stakes, leaving out bets of 0", () => {
    const base = { score: null, winProbability: 60, reasoning: "r", usedLessons: [], pickedAt: "t" };
    expect(analystEntries(5, [
      { ...base, player: "analyst-top", winner: "T1", score: "3-1", stake: 1000, scoreStake: 300 },
      { ...base, player: "analyst-mid", winner: "GEN", score: "3-0", stake: 100 },
      { ...base, player: "analyst-adc", winner: "GEN", stake: 0 },
    ])).toEqual([
      { player: "analyst-top", market: "winner", choice: "T1", stake: 1000 },
      { player: "analyst-top", market: "score", choice: "3-1", stake: 300 },
      { player: "analyst-mid", market: "winner", choice: "GEN", stake: 100 },
    ]);
    expect(analystEntries(1, [{ ...base, player: "analyst-top", winner: "T1", score: "1-0", stake: 500, scoreStake: 150 }])).toEqual([
      { player: "analyst-top", market: "winner", choice: "T1", stake: 500 },
    ]);
  });

  it("locks the lessons an analyst recalled into its winner entry, so the fingerprint proves which memories it used", () => {
    const base = { score: null, winProbability: 70, reasoning: "r", pickedAt: "2026-10-23T12:00:00Z" };
    const used = [{ blobId: "blobB", text: "b", createdAt: "2026-10-22T00:00:00Z" }, { blobId: "blobA", text: "a", createdAt: "2026-10-21T00:00:00Z" }];
    expect(analystEntries(1, [{ ...base, player: "analyst-mid", winner: "T1", stake: 700, usedLessons: used }])).toEqual([
      { player: "analyst-mid", market: "winner", choice: "T1", stake: 700, lessons: ["blobA", "blobB"] },
    ]);
  });
});

