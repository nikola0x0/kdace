import { describe, expect, it } from "vitest";
import { pedigreeLines, regionRecords } from "../src/core/pedigree.ts";
import type { SeriesResult } from "../src/core/scout.ts";

const s = (teamA: string, teamB: string, winner: string, league = "MSI 2026"): SeriesResult =>
  ({ matchId: `${teamA}${teamB}${league}`, startTime: "2026-06-01T00:00:00Z", block: "", bestOf: 3, state: "completed", teamA, teamB, winsA: 0, winsB: 0, winner, league }) as SeriesResult;
const homes = { T1: "LCK 2026", GEN: "LCK 2026", LOS: "CBLOL 2026", FUR: "CBLOL 2026", G2: "LEC 2026" };
const series = [s("T1", "LOS", "T1"), s("GEN", "FUR", "GEN", "EWC 2026"), s("G2", "LOS", "G2"), s("T1", "GEN", "T1"), s("T1", "LOS", "LOS", "LCK 2026")];

describe("region strength", () => {
  it("counts only cross-region series at international events", () => {
    const { byRegion, pair } = regionRecords(series, homes);
    expect(byRegion).toEqual({ LCK: { w: 2, l: 0 }, CBLOL: { w: 0, l: 3 }, LEC: { w: 1, l: 0 } });
    expect(pair["LCK|CBLOL"]).toEqual({ w: 2, l: 0 });
  });
  it("puts the real records, the matchup's head-to-head and Worlds history in front of the analysts", () => {
    const lines = pedigreeLines({ code: "LOS", home: "CBLOL 2026" }, { code: "T1", home: "LCK 2026" }, series, homes).join("\n");
    expect(lines).toContain("VERY BIG factor");
    expect(lines).toContain("LCK 2-0, LEC 1-0, CBLOL 0-3");
    expect(lines).toContain("This matchup is CBLOL vs LCK: CBLOL went 0-2 against LCK in 2026; CBLOL 0% vs LCK 100% against other regions overall.");
    expect(lines).toContain("Worlds champions by region since 2013: LCK 10, LPL 3, every other region 0.");
    expect(lines).toContain("T1 (LCK): 6 Worlds titles (2013, 2015, 2016, 2023, 2024, 2025); lost finals 2017, 2022; reigning world champion.");
    expect(lines).toContain("LOS (CBLOL): no Worlds titles or finals before 2026.");
  });
  it("says records are comparable when both teams share a region", () => {
    expect(pedigreeLines({ code: "T1", home: "LCK 2026" }, { code: "GEN", home: "LCK 2026" }, series, homes).join("\n")).toContain("Both teams are from LCK");
  });
});
