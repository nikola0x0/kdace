// Analyst final call: once per series, shortly before lock, each analyst may add AXP to the side it already picked,
// knowing the pools, the multipliers and its AXP after the day's results. The top-ups are their own batch, committed
// on Sui under `<matchId>:final`, and settle in the same winner pool. Dependency-free so the web app can import it.
import { MIN_STAKE, type Analyst, type AnalystPick } from "./analysts.ts";
import type { BatchEntry } from "./batch.ts";
import { extractJson } from "./json.ts";
import { LOCK_MARGIN_MS } from "./select.ts";
import type { SeriesRecord } from "./store.ts";
import type { Series } from "./worlds.ts";

/** A series is close enough for the final call from this long before its start. */
export const FINAL_CALL_WINDOW_MS = 30 * 60_000;
/** Safety margin: no final call starts with less than this left before lock (start − 5 min). */
export const FINAL_CALL_MARGIN_MS = 3 * 60_000;
/** "Earlier series that day": those starting up to this long before this one. */
export const SAME_DAY_MS = 12 * 3600_000;

export const finalMarketId = (matchId: string) => `${matchId}:final`;

/** The start a final call must beat: the stored start, or the official one if it has moved earlier. */
export const effectiveStart = (r: SeriesRecord, official: Series | undefined) => Math.min(Date.parse(r.series.startTime), official ? Date.parse(official.startTime) : Infinity);

/** Nothing left to settle: settled, void, or missed with no bets on chain. */
const done = (r: SeriesRecord | undefined) => !!r && (r.status === "settled" || r.status === "void" || (r.status === "missed" && r.fans?.status !== "committed"));

/**
 * Whether a record's final call should run now: the analysts committed, it has had no final call, the game hasn't
 * started, there are at least 3 minutes left before lock, and either the start is 30 minutes away or less, or every
 * earlier series that day (at least one) is finished.
 */
export function finalCallDue(r: SeriesRecord, schedule: Series[], records: SeriesRecord[], now: Date): { due: boolean; reason: string } {
  if (r.status !== "committed" || !r.commitDigest || r.finalCall || !r.picks.length) return { due: false, reason: "not open for a final call" };
  const official = schedule.find((s) => s.matchId === r.series.matchId);
  if (official && official.state !== "unstarted") return { due: false, reason: "already started" };
  const start = effectiveStart(r, official);
  if (now.getTime() >= start - LOCK_MARGIN_MS - FINAL_CALL_MARGIN_MS) return { due: false, reason: "too close to lock" };
  if (now.getTime() >= start - FINAL_CALL_WINDOW_MS) return { due: true, reason: "30 minutes to the start" };
  const byId = new Map(records.map((x) => [x.series.matchId, x]));
  const earlier = schedule.filter((s) => s.matchId !== r.series.matchId && Date.parse(s.startTime) < start && Date.parse(s.startTime) >= start - SAME_DAY_MS);
  if (earlier.length && earlier.every((s) => done(byId.get(s.matchId)))) return { due: true, reason: "every earlier series today is settled" };
  return { due: false, reason: "waiting" };
}

/** One analyst's final call as published. */
export type FinalCallEntry = { player: string; add: number; reasoning: string; decidedAt: string };

/** The top-up batch entries: one winner entry per analyst who added, on the side it originally picked. */
export const finalCallEntries = (picks: AnalystPick[], calls: FinalCallEntry[]): BatchEntry[] =>
  calls.filter((c) => c.add > 0).map((c) => ({ player: c.player, market: "winner" as const, choice: picks.find((p) => p.player === c.player)!.winner, stake: c.add }));

export type WinnerPools = { analysts: Record<string, number>; fans: Record<string, number> | null };

/** The winner-market pool per team: the analysts' committed stakes, and the fans' (null when Supabase couldn't be read). */
export function winnerPools(r: SeriesRecord, fans: Record<string, number> | null): WinnerPools {
  const analysts: Record<string, number> = { [r.series.teamA]: 0, [r.series.teamB]: 0 };
  for (const e of r.batch ? (JSON.parse(r.batch).entries as BatchEntry[]) : []) if (e.market === "winner" && e.choice in analysts) analysts[e.choice] += e.stake;
  return { analysts, fans: fans ? { [r.series.teamA]: fans[r.series.teamA] ?? 0, [r.series.teamB]: fans[r.series.teamB] ?? 0 } : null };
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function buildFinalCallPrompt(a: Analyst, s: Series, pick: AnalystPick, available: number, pools: WinnerPools, history: string[]): string {
  const total = (t: string) => pools.analysts[t] + (pools.fans?.[t] ?? 0);
  const all = total(s.teamA) + total(s.teamB);
  const line = (t: string) => `- ${t}: ${fmt(total(t))} AXP (analysts ${fmt(pools.analysts[t])}${pools.fans ? `, fans ${fmt(pools.fans[t])}` : ""}), pays ${total(t) ? `${(all / total(t)).toFixed(2)}×` : "everything to whoever backs it"}`;
  return `You are the ${a.name} analyst on KDAce, a LoL Worlds 2026 prediction board. Your voice: ${a.voice}
Core belief: ${a.belief}

Final call on ${s.teamA} vs ${s.teamB}, best of ${s.bestOf} (${s.block}), just before lock.
This morning you picked ${pick.winner}${pick.score ? ` ${pick.score}` : ""} at ${pick.winProbability}% and staked ${fmt(pick.stake)} AXP on it. Your reasoning: "${pick.reasoning}"

Results so far this tournament:
${history.join("\n") || "(none yet)"}

The winner pool right now (parimutuel: winners split the whole pool in proportion to their stakes):
${line(s.teamA)}
${line(s.teamB)}
${pools.fans ? "" : "(The fans' pool isn't available right now; these are the analysts' stakes only.)\n"}
You have ${fmt(available)} AXP available. You may only add to ${pick.winner} (the side you picked), or add nothing. Adding is optional: 0 is a fine answer.
Reply with only JSON: {"add": <0, or a whole number from ${MIN_STAKE} to ${available}>, "reasoning": "<one punchy sentence in your voice>"}`;
}

/** The analyst's reply, strictly validated: add is 0 or a whole number from 10 up to what's available. */
export function parseFinalCall(reply: string, available: number): { add: number; reasoning: string } {
  const raw = extractJson<{ add?: unknown; reasoning?: unknown }>(reply);
  const add = raw.add;
  if (typeof add !== "number" || !Number.isInteger(add) || add < 0) throw new Error(`add ${String(add)} is not a whole, non-negative number`);
  if (add > 0 && add < MIN_STAKE) throw new Error(`add ${add} is below the ${MIN_STAKE} AXP minimum`);
  if (add > available) throw new Error(`add ${add} is more than the ${available} AXP available`);
  return { add, reasoning: String(raw.reasoning ?? "").trim() };
}
