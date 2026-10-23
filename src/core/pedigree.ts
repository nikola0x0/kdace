// Context Scout's 2026-only numbers can't show: how strong each home region is at Worlds, and each team's Worlds
// history. Without it a 23-9 record in a smaller league reads the same as 25-14 in the LCK. Facts are pre-2026 and
// static; update after each Worlds.

/** How strong each region has been at Worlds (1 = strongest). */
const REGION_TIER: Record<string, 1 | 2 | 3> = { LCK: 1, LPL: 1, LEC: 2, LCS: 3, LCP: 3, CBLOL: 3 };

/** Worlds titles and lost finals before 2026, for teams at Worlds 2026 (organisation lineage noted where it differs). */
export const WORLDS_HISTORY: Record<string, { titles: number[]; finals: number[]; note?: string }> = {
  T1: { titles: [2013, 2015, 2016, 2023, 2024, 2025], finals: [2017, 2022] },
  DK: { titles: [2020], finals: [2021], note: "won 2020 as DAMWON Gaming" },
  IG: { titles: [2018], finals: [] },
  GEN: { titles: [2017], finals: [], note: "won 2017 as Samsung Galaxy, the roster Gen.G grew from" },
  G2: { titles: [], finals: [2019] },
  BLG: { titles: [], finals: [2024] },
};

const league = (home: string | null) => (home ?? "").replace(/ 2026$/, "");

function teamLine(code: string, home: string | null): string {
  const h = WORLDS_HISTORY[code];
  const tier = REGION_TIER[league(home)];
  const region = home ? `${league(home)} (${tier === 1 ? "one of the two strongest regions" : tier === 2 ? "second-tier region" : tier === 3 ? "weaker region at Worlds" : "region"})` : "unknown region";
  if (!h) return `${code}: ${region}; no Worlds titles or finals before 2026.`;
  const parts = [
    h.titles.length ? `${h.titles.length} Worlds title${h.titles.length > 1 ? "s" : ""} (${h.titles.join(", ")})` : "no Worlds titles",
    h.finals.length ? `lost final${h.finals.length > 1 ? "s" : ""} ${h.finals.join(", ")}` : null,
    h.titles.includes(2025) ? "reigning world champion" : null,
    h.note ?? null,
  ].filter(Boolean);
  return `${code}: ${region}; ${parts.join("; ")}.`;
}

/** One line on the region gap between two teams, when there is one. */
export function regionGap(a: { code: string; home: string | null }, b: { code: string; home: string | null }): string | null {
  const ta = REGION_TIER[league(a.home)], tb = REGION_TIER[league(b.home)];
  if (!ta || !tb || ta === tb) return null;
  const [strong, weak] = ta < tb ? [a, b] : [b, a];
  const gap = Math.abs(ta - tb);
  return `REGION GAP: ${strong.code} (${league(strong.home)}) is ${gap === 2 ? "two tiers" : "a tier"} above ${weak.code} (${league(weak.home)}). This is a VERY BIG factor: at Worlds, teams from the weaker region rarely beat the stronger region's teams${gap === 2 ? ", and a two-tier gap usually makes the stronger team a clear favourite (around 75-85%)" : ""}, whatever their domestic records say. Only clear international results should move you off it.`;
}

/** The context block appended to a matchup digest. */
export function pedigreeLines(a: { code: string; home: string | null }, b: { code: string; home: string | null }): string[] {
  const gap = regionGap(a, b);
  return [
    ...(gap ? [gap] : []),
    "Context beyond 2026 (records from different leagues are NOT directly comparable):",
    "  Region strength at Worlds: LCK and LPL strongest, then LEC, then LCS, LCP and CBLOL. Form and records earned in a weaker league count for less; international results count most.",
    `  ${teamLine(a.code, a.home)}`,
    `  ${teamLine(b.code, b.home)}`,
  ];
}
