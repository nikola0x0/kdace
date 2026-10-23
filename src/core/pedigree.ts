// Context Scout's per-team numbers can't show on their own: how strong each home region is, measured from real
// cross-region series (2026 internationals in Scout's data), plus each team's Worlds history. Without it a 23-9 record
// in a smaller league reads the same as 25-14 in the LCK. The Worlds history is static and pre-2026.
import type { SeriesResult } from "./scout.ts";

type Rec = { w: number; l: number };
type Side = { code: string; home: string | null };

/** Worlds titles and lost finals before 2026, for teams at Worlds 2026 (organisation lineage noted where it differs). */
export const WORLDS_HISTORY: Record<string, { titles: number[]; finals: number[]; note?: string }> = {
  T1: { titles: [2013, 2015, 2016, 2023, 2024, 2025], finals: [2017, 2022] },
  DK: { titles: [2020], finals: [2021], note: "won 2020 as DAMWON Gaming" },
  IG: { titles: [2018], finals: [] },
  GEN: { titles: [2017], finals: [], note: "won 2017 as Samsung Galaxy, the roster Gen.G grew from" },
  G2: { titles: [], finals: [2019] },
  BLG: { titles: [], finals: [2024] },
};
/** Worlds champions by region, 2013-2025. */
const TITLES_BY_REGION = "LCK 10, LPL 3, every other region 0";

const league = (home: string | null) => (home ?? "").replace(/ 2026$/, "");
const DOMESTIC = /^(LCK|LPL|LEC|LCS|CBLOL|LCP)\b/;
const pct = (r: Rec) => Math.round((r.w / (r.w + r.l)) * 100);
const fmt = (r: Rec) => `${r.w}-${r.l}`;

/** Cross-region series records from international events: per region, and per region pair ("A|B" from A's side). */
export function regionRecords(series: SeriesResult[], homes: Record<string, string | null>) {
  const byRegion: Record<string, Rec> = {};
  const pair: Record<string, Rec> = {};
  for (const s of series) {
    if (s.state !== "completed" || !s.winner || DOMESTIC.test(s.league)) continue;
    const a = league(homes[s.teamA] ?? null), b = league(homes[s.teamB] ?? null);
    if (!a || !b || a === b) continue;
    const [w, l] = s.winner === s.teamA ? [a, b] : [b, a];
    (byRegion[w] ??= { w: 0, l: 0 }).w++;
    (byRegion[l] ??= { w: 0, l: 0 }).l++;
    (pair[`${w}|${l}`] ??= { w: 0, l: 0 }).w++;
    (pair[`${l}|${w}`] ??= { w: 0, l: 0 }).l++;
  }
  return { byRegion, pair };
}

function teamLine(t: Side): string {
  const h = WORLDS_HISTORY[t.code];
  const region = league(t.home) || "unknown region";
  if (!h) return `${t.code} (${region}): no Worlds titles or finals before 2026.`;
  const parts = [
    h.titles.length ? `${h.titles.length} Worlds title${h.titles.length > 1 ? "s" : ""} (${h.titles.join(", ")})` : "no Worlds titles",
    h.finals.length ? `lost final${h.finals.length > 1 ? "s" : ""} ${h.finals.join(", ")}` : null,
    h.titles.includes(2025) ? "reigning world champion" : null,
    h.note ?? null,
  ].filter(Boolean);
  return `${t.code} (${region}): ${parts.join("; ")}.`;
}

/** The context block appended to a matchup digest: region strength from real results, then Worlds history. */
export function pedigreeLines(a: Side, b: Side, series: SeriesResult[] = [], homes: Record<string, string | null> = {}): string[] {
  const { byRegion, pair } = regionRecords(series, homes);
  const ra = league(a.home), rb = league(b.home);
  const lines = ["Region strength (domestic records from different leagues are not comparable; international results count):"];
  const table = Object.entries(byRegion).sort(([, x], [, y]) => pct(y) - pct(x) || y.w - x.w).map(([r, rec]) => `${r} ${fmt(rec)}`);
  if (table.length) lines.push(`  2026 series vs other regions (First Stand, MSI, EWC, Americas Cup, Worlds so far): ${table.join(", ")}.`);
  if (ra && rb && ra !== rb) {
    const h2h = pair[`${ra}|${rb}`];
    const recA = byRegion[ra], recB = byRegion[rb];
    lines.push(`  This matchup is ${ra} vs ${rb}: ${h2h ? `${ra} went ${fmt(h2h)} against ${rb} in 2026` : `no ${ra} vs ${rb} series in 2026`}${recA && recB ? `; ${ra} ${pct(recA)}% vs ${rb} ${pct(recB)}% against other regions overall` : ""}.`);
    const titles = (r: string) => (r === "LCK" ? 10 : r === "LPL" ? 3 : 0);
    const big = recA && recB && recA.w + recA.l >= 6 && recB.w + recB.l >= 6 && Math.abs(pct(recA) - pct(recB)) >= 20;
    const strong = big ? (pct(recA) > pct(recB) ? ra : rb) : titles(ra) !== titles(rb) && (titles(ra) >= 3 || titles(rb) >= 3) ? (titles(ra) > titles(rb) ? ra : rb) : null;
    lines.push(strong
      ? `  BIG REGION GAP: ${strong} is clearly the stronger region here. This is a VERY BIG factor; only clear international results should move you off it.`
      : `  No big region gap: these regions' international records are close or the samples are small, so treat them as even and decide on the two teams.`);
  } else if (ra && ra === rb) lines.push(`  Both teams are from ${ra}, so their domestic records are directly comparable.`);
  lines.push(`  Worlds champions by region since 2013: ${TITLES_BY_REGION}.`, `  ${teamLine(a)}`, `  ${teamLine(b)}`);
  return lines;
}
