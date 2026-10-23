// What to do with a committed series once its game should be over: settle it on the official result, void it, or wait.
// Dependency-free (types only) so the web app can import it.
import type { SeriesRecord } from "./store.ts";
import type { Series } from "./worlds.ts";

/** Winner and score posted on Sui for a void series (ledger::post_result takes any string). */
export const VOID = "VOID";

/** A committed series with no official result this long after its scheduled start is voided and every stake refunded. */
export const VOID_AFTER_MS = 48 * 3600_000;

export type SettleAction = { kind: "settle"; result: { winner: string; score: string } } | { kind: "void"; reason: string } | { kind: "wait"; reason: string };

/** The official result, or null when the feed is not final yet (no winner, unfinished score, unknown team). */
export function officialResult(s: Series): { winner: string; score: string } | null {
  const winsW = Math.max(s.winsA ?? 0, s.winsB ?? 0);
  const winsL = Math.min(s.winsA ?? 0, s.winsB ?? 0);
  const winnerWins = s.winner === s.teamA ? s.winsA : s.winsB;
  if ((s.winner !== s.teamA && s.winner !== s.teamB) || winnerWins !== winsW || winsW !== Math.ceil(s.bestOf / 2) || winsL >= winsW) return null;
  return { winner: s.winner, score: `${winsW}-${winsL}` };
}

/** True when lolesports marks the series cancelled (the feed's state is free text; anything with "cancel"). */
export const isCancelled = (s: Series) => /cancel/i.test(String(s.state));

/**
 * The next step for a record awaiting its result. A result already posted on chain is always finished as posted. Otherwise:
 * the official result settles it; a cancelled series, or one with no official result 48 h after its start (the official
 * start when the series is still listed, else the start stored at commit), is voided. A series missing from the schedule
 * is not treated as cancelled before then, and nothing is decided when the schedule couldn't be fetched (`scheduleOk`).
 */
export function settleAction(r: SeriesRecord, official: Series | undefined, scheduleOk: boolean, now: Date): SettleAction {
  if (r.result) return r.result.winner === VOID ? { kind: "void", reason: "VOID already posted" } : { kind: "settle", result: { winner: r.result.winner, score: r.result.score } };
  if (!scheduleOk) return { kind: "wait", reason: "schedule unavailable" };
  const result = official?.state === "completed" ? officialResult(official) : null;
  if (result) return { kind: "settle", result };
  if (official && isCancelled(official)) return { kind: "void", reason: "cancelled by lolesports" };
  const start = Date.parse(official?.startTime ?? r.series.startTime);
  if (now.getTime() >= start + VOID_AFTER_MS) return { kind: "void", reason: official ? "no official result 48 h after the start" : "gone from the schedule 48 h after the start" };
  if (official?.state === "completed") return { kind: "wait", reason: "marked completed but the result is not final yet" };
  return { kind: "wait", reason: official ? "not finished" : "missing from the schedule (not cancelled before 48 h)" };
}
