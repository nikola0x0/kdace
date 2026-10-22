import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTeamLogos } from "../src/core/worlds.ts";

describe("parseTeamLogos", () => {
  const logos = parseTeamLogos(JSON.parse(readFileSync("test/fixtures/worlds-schedule.json", "utf8")));

  it("maps each team code to its logo over https", () => {
    expect(logos.G2).toBe("https://static.lolesports.com/teams/G2-FullonDark.png");
  });

  it("leaves out TBD placeholders", () => {
    expect(logos.TBD).toBeUndefined();
  });
});
