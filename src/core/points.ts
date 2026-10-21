// Pot-split points and the KDA board. Each market's pot is split equally among correct pickers.
import type { BatchEntry } from "./batch.ts";

export type SettledSeries = { matchId: string; bestOf: 1 | 3 | 5; entries: BatchEntry[]; result: { winner: string; score: string } };

export type BoardRow = { player: string; points: number; k: number; d: number; a: number };

export const POT = 1000;

/** Entries in markets that count: every winner market, and the score market only for Bo3 and Bo5. */
const countedEntries = (s: SettledSeries) => s.entries.filter((e) => e.market === "winner" || s.bestOf > 1);

const isCorrect = (s: SettledSeries, e: BatchEntry) => e.choice === (e.market === "winner" ? s.result.winner : s.result.score);

export function marketPoints(s: SettledSeries): Record<string, number> {
  const points: Record<string, number> = {};
  for (const market of ["winner", "score"] as const) {
    const correct = countedEntries(s).filter((e) => e.market === market && isCorrect(s, e));
    for (const e of correct) points[e.player] = (points[e.player] ?? 0) + Math.floor(POT / correct.length);
  }
  return points;
}

export function computeBoard(all: SettledSeries[]): BoardRow[] {
  const rows = new Map<string, BoardRow>();
  const row = (player: string) => rows.get(player) ?? rows.set(player, { player, points: 0, k: 0, d: 0, a: 0 }).get(player)!;
  for (const s of all) {
    for (const [player, pts] of Object.entries(marketPoints(s))) row(player).points += pts;
    const correctWinners = countedEntries(s).filter((e) => e.market === "winner" && isCorrect(s, e)).length;
    for (const e of countedEntries(s)) {
      const r = row(e.player);
      if (!isCorrect(s, e)) r.d++;
      else {
        r.k++;
        if (e.market === "winner" && correctWinners > 1) r.a++;
      }
    }
  }
  return [...rows.values()].sort((x, y) => y.points - x.points || y.k - x.k || x.player.localeCompare(y.player));
}
