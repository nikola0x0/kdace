// AXP settlement and the leaderboard. AXP is play money: every player starts with 10,000 and stakes it on outcomes.
// Each market settles parimutuel: the winners split the market's pool in proportion to their stakes.
import { assertStakes, type BatchEntry } from "./batch.ts";

export type SettledSeries = { matchId: string; bestOf: 1 | 3 | 5; entries: BatchEntry[]; result: { winner: string; score: string } };

/** A leaderboard row: balance = AXP_START + net over settled markets; bets = markets entered; KDA as before. */
/** `balance` here is the settled total (10,000 + net); the site subtracts AXP in play to show what's free to bet. */
export type BoardRow = { player: string; balance: number; net: number; k: number; d: number; a: number; bets: number };

/** Every player's starting balance. */
export const AXP_START = 10000;

/** Entries in markets that count: every winner market, and the score market only for Bo3 and Bo5. */
const countedEntries = (s: SettledSeries) => s.entries.filter((e) => e.market === "winner" || s.bestOf > 1);

const isCorrect = (s: SettledSeries, e: BatchEntry) => e.choice === (e.market === "winner" ? s.result.winner : s.result.score);

/**
 * Each player's net AXP for one series, summed over its markets. Per market: winners get floor(stake / winningStake × pool)
 * back, losers lose their stake; if nobody picked the winning outcome, everyone gets their stake back. Rounding dust is dropped.
 */
export function marketNet(s: SettledSeries): Record<string, number> {
  assertStakes(s.entries); // a negative or fractional stake would corrupt every payout in its market
  const net: Record<string, number> = {};
  for (const market of ["winner", "score"] as const) {
    const entries = countedEntries(s).filter((e) => e.market === market);
    const pool = entries.reduce((sum, e) => sum + e.stake, 0);
    const winningStake = entries.filter((e) => isCorrect(s, e)).reduce((sum, e) => sum + e.stake, 0);
    for (const e of entries) {
      // Integer math (stake × pool first) so the floor never suffers from floating-point error.
      const result = winningStake === 0 ? 0 : isCorrect(s, e) ? Math.floor((e.stake * pool) / winningStake) - e.stake : -e.stake;
      net[e.player] = (net[e.player] ?? 0) + result;
    }
  }
  return net;
}

export function computeBoard(all: SettledSeries[]): BoardRow[] {
  const rows = new Map<string, BoardRow>();
  const row = (player: string) => rows.get(player) ?? rows.set(player, { player, balance: AXP_START, net: 0, k: 0, d: 0, a: 0, bets: 0 }).get(player)!;
  for (const s of all) {
    for (const [player, n] of Object.entries(marketNet(s))) {
      row(player).net += n;
      row(player).balance += n;
    }
    const correctWinners = countedEntries(s).filter((e) => e.market === "winner" && isCorrect(s, e)).length;
    for (const e of countedEntries(s)) {
      const r = row(e.player);
      r.bets++;
      if (!isCorrect(s, e)) r.d++;
      else {
        r.k++;
        if (e.market === "winner" && correctWinners > 1) r.a++;
      }
    }
  }
  return [...rows.values()].sort((x, y) => y.balance - x.balance || y.k - x.k || x.player.localeCompare(y.player));
}
