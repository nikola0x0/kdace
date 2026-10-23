import { describe, expect, it } from "vitest";
import { pedigreeLines } from "../src/core/pedigree.ts";

describe("pedigreeLines", () => {
  it("tells the analysts region strength and Worlds history, so a smaller league's record isn't read like the LCK's", () => {
    const lines = pedigreeLines({ code: "LOS", home: "CBLOL 2026" }, { code: "T1", home: "LCK 2026" }).join("\n");
    expect(lines).toContain("NOT directly comparable");
    expect(lines).toMatch(/^REGION GAP: T1 \(LCK\) is two tiers above LOS \(CBLOL\)\. This is a VERY BIG factor/);
    expect(lines).toContain("LOS: CBLOL (weaker region at Worlds); no Worlds titles or finals before 2026.");
    expect(lines).toContain("T1: LCK (one of the two strongest regions); 6 Worlds titles (2013, 2015, 2016, 2023, 2024, 2025); lost finals 2017, 2022; reigning world champion.");
  });
  it("adds no region gap line for two teams from the same tier", () => {
    expect(pedigreeLines({ code: "GEN", home: "LCK 2026" }, { code: "IG", home: "LPL 2026" })[0]).not.toContain("REGION GAP");
  });
});
