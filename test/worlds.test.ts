import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSchedule } from "../src/core/worlds.ts";

const fixture = JSON.parse(readFileSync("test/fixtures/worlds-schedule.json", "utf8"));

describe("parseSchedule", () => {
  const series = parseSchedule(fixture);
  it("parses completed Play-In results", () => {
    const first = series.find((s) => s.matchId === "115660588583171786")!;
    expect(first).toMatchObject({ block: "Play-Ins", bestOf: 5, state: "completed", teamA: "KC", teamB: "C9", winsA: 3, winsB: 2, winner: "KC" });
  });
  it("keeps unstarted series with known teams", () => {
    const opener = series.find((s) => s.matchId === "115660540726095005")!;
    expect(opener).toMatchObject({ bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winner: null });
  });
  it("marks undetermined teams as TBD", () => {
    const tbd = series.find((s) => s.matchId === "115660540726095021")!;
    expect([tbd.teamA, tbd.teamB]).toEqual(["TBD", "TBD"]);
  });
});
