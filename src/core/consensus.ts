// The stats side's headline number: the average of each analyst's win probability for team A.
import type { AnalystPick } from "./analysts.ts";

export function aiConsensus(picks: AnalystPick[], teamA: string): number | null {
  if (!picks.length) return null;
  return picks.reduce((sum, p) => sum + (p.winner === teamA ? p.winProbability : 100 - p.winProbability), 0) / picks.length;
}
