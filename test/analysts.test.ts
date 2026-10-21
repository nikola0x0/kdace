import { describe, expect, it } from "vitest";
import { ANALYSTS, buildPickPrompt, buildReflectPrompt, parsePick } from "../src/core/analysts.ts";
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
    const pick = parsePick(reply({ winner: "GEN", score: "3-1", winProbability: 64, reasoning: "r", usedLessonIds: [] }), adc, bo5, lessons, now);
    const p = buildReflectPrompt(adc, bo5, pick, { winner: "T1", score: "3-2" }, "Top: told you.");
    for (const s of [adc.belief, `${adc.name} lesson:`, "T1", "3-2", "Top: told you."]) expect(p).toContain(s);
  });
});
