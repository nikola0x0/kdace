// Title picks: once a day, each analyst names who wins Worlds. The day's calls are fingerprinted and committed on Sui
// like a series batch (market id "title:<YYYY-MM-DD>"), so a call can't be rewritten after the fact. No AXP rides on them.
import type { Analyst } from "./analysts.ts";
import type { BatchEntry } from "./batch.ts";
import type { Chain } from "./chain.ts";
import { extractJson } from "./json.ts";
import type { TeamAggregate } from "./scout.ts";
import type { Series } from "./worlds.ts";

export type TitlePick = {
  player: string;
  /** The team this analyst says wins Worlds. */
  champion: string;
  /** Its chance of winning the whole thing, 1-100. */
  probability: number;
  /** Next most likely winners, best first (up to 2, never the champion). */
  contenders: string[];
  reasoning: string;
  pickedAt: string;
};

export type TitleDay = {
  date: string;
  status: "committing" | "committed";
  picks: TitlePick[];
  batch: string;
  batchHash: string;
  commitDigest: string | null;
  chain?: Chain;
};

export const titleMarketId = (date: string) => `title:${date}`;
export const utcDate = (d: Date) => d.toISOString().slice(0, 10);

const isPlayIn = (block: string) => block.toLowerCase().includes("play");
const isSwiss = (block: string) => block.toLowerCase().includes("swiss");
const loserOf = (s: Series) => (s.winner === s.teamA ? s.teamB : s.teamA);

/**
 * Teams still in the tournament: everyone past the Play-In (or everyone, before the main stage is scheduled), minus
 * Swiss teams on 3 losses and anyone who lost a knockout series. Empty strings and TBD placeholders are ignored.
 */
export function aliveTeams(series: Series[]): string[] {
  const real = (t: string) => !!t && t !== "TBD";
  const main = series.filter((s) => !isPlayIn(s.block));
  const pool = (main.length ? main : series).flatMap((s) => [s.teamA, s.teamB]).filter(real);
  const out = new Set<string>();
  const swissLosses: Record<string, number> = {};
  for (const s of main.filter((x) => x.state === "completed" && x.winner)) {
    if (isSwiss(s.block)) {
      const l = loserOf(s);
      if ((swissLosses[l] = (swissLosses[l] ?? 0) + 1) >= 3) out.add(l);
    } else out.add(loserOf(s));
  }
  return [...new Set(pool)].filter((t) => !out.has(t)).sort();
}

/** True once the final has been played: no more title picks. */
export const tournamentOver = (series: Series[]) => series.some((s) => s.block.toLowerCase() === "final" && s.state === "completed");

/** One line per team from Scout's aggregates, so the analysts compare the field on real numbers. */
export function fieldLines(teams: string[], aggregates: Record<string, TeamAggregate>): string[] {
  return teams.map((t) => {
    const a = aggregates[t];
    if (!a) return `${t}: no data`;
    const rec = (r: { w: number; l: number }) => `${r.w}-${r.l}`;
    const titles = a.sources.reduce((n, s) => n + s.titles, 0);
    const st = a.stats;
    return [
      `${t} [${a.homeLeague ?? "?"}]: 2026 series ${rec(a.season.series)}, games ${rec(a.season.games)}, ${titles} title${titles === 1 ? "" : "s"}, vs other regions ${rec(a.vsInternational)}, form ${a.form}`,
      st?.avgGoldDiff15 != null ? `GD@15 ${st.avgGoldDiff15 >= 0 ? "+" : ""}${(st.avgGoldDiff15 / 1000).toFixed(1)}k over ${st.games} recent games` : null,
    ].filter(Boolean).join(" | ");
  });
}

export function buildTitlePrompt(a: Analyst, alive: string[], field: string[], history: string[]): string {
  return `You are the ${a.name} analyst on KDAce, a LoL Worlds 2026 prediction board. Your voice: ${a.voice}
Core belief: ${a.belief}

Teams still alive at Worlds 2026:
${field.join("\n")}

Results so far this tournament:
${history.join("\n") || "(none yet)"}

Who wins Worlds 2026? Make your call for today; you can change it tomorrow.
Reply with only JSON:
{"champion":"<one of ${alive.join(", ")}>","probability":<1-100, its chance to win the whole tournament>,"contenders":["<next most likely>","<third>"],"reasoning":"<one or two sentences in your voice>"}`;
}

export function parseTitlePick(reply: string, a: Analyst, alive: string[], now: Date): TitlePick {
  const raw = extractJson<{ champion?: string; probability?: number; contenders?: string[]; reasoning?: string }>(reply);
  if (!raw.champion || !alive.includes(raw.champion)) throw new Error(`champion ${raw.champion} is not a team still alive`);
  const p = Math.round(Number(raw.probability));
  if (!(p >= 1 && p <= 100)) throw new Error(`probability ${raw.probability} is outside 1-100`);
  const contenders = [...new Set((raw.contenders ?? []).filter((t) => alive.includes(t) && t !== raw.champion))].slice(0, 2);
  return { player: a.player, champion: raw.champion, probability: p, contenders, reasoning: String(raw.reasoning ?? ""), pickedAt: now.toISOString() };
}

/** The day's batch entries: one "title" entry per analyst, no AXP. */
export const titleEntries = (picks: TitlePick[]): BatchEntry[] => picks.map((p) => ({ player: p.player, market: "title", choice: p.champion, stake: 0 }));

/** Each analyst's latest call and how it changed over time (newest day last). */
export function titleHistory(days: TitleDay[]): Record<string, { date: string; champion: string; probability: number }[]> {
  const out: Record<string, { date: string; champion: string; probability: number }[]> = {};
  for (const d of days.filter((x) => x.status === "committed"))
    for (const p of d.picks) (out[p.player] ??= []).push({ date: d.date, champion: p.champion, probability: p.probability });
  return out;
}

