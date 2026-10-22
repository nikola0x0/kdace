// Season prize pool split (design preview, no real money moves). Mirrors move/sources/prize_pool.move exactly.
//
// The top 20 human players share the pool by place, in basis points (sums to 10,000):
//   1st 2500 · 2nd 1500 · 3rd 1000 · 4th–5th 600 each · 6th–10th 360 each · 11th–20th 200 each.
// Fewer than 20 humans: the whole pool is still paid. Each place gets floor(pool × bps / paidBps), where paidBps is the
// sum of the paid places' bps, so unpaid shares spread over the paid places in proportion to their own share.
// Rounding dust goes to 1st. AI analysts (players starting with "analyst-") never take a prize place.

/** Number of paid places. */
export const PRIZE_PLACES = 20;

/** Basis points per place, best first. */
export const PLACE_BPS: readonly number[] = [2500, 1500, 1000, 600, 600, 360, 360, 360, 360, 360, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200];

export type PrizeShare = { place: number; player: string; bps: number; amount: number };

export const isAnalyst = (player: string) => player.startsWith("analyst-");

/** Basis points for a 0-based place; 0 past 20th. Same as `prize_pool::place_bps`. */
export const placeBps = (place: number) => PLACE_BPS[place] ?? 0;

/**
 * Amounts for `n` paid places out of `pool` (whole base units). Same as `prize_pool::split_amounts`: BigInt math so it
 * floors exactly like Move's u128 arithmetic, and the amounts always sum to `pool`.
 */
export function splitAmounts(pool: number, n: number): number[] {
  if (!Number.isSafeInteger(pool) || pool < 0) throw new Error(`pool must be a whole, non-negative amount: ${pool}`);
  const places = Math.min(Math.max(0, Math.floor(n)), PRIZE_PLACES);
  if (places === 0) return [];
  const total = BigInt(pool);
  const paidBps = BigInt(PLACE_BPS.slice(0, places).reduce((s, b) => s + b, 0));
  const amounts = PLACE_BPS.slice(0, places).map((b) => (total * BigInt(b)) / paidBps);
  const dust = total - amounts.reduce((s, a) => s + a, BigInt(0));
  amounts[0] += dust;
  return amounts.map(Number);
}

/**
 * The prize for each of the top 20 humans in `rankedHumans` (already ranked, best first). Analysts are skipped, so the
 * next human moves up. Returns one share per paid place.
 */
export function prizeSplit(pool: number, rankedHumans: string[]): PrizeShare[] {
  const humans = rankedHumans.filter((p) => !isAnalyst(p)).slice(0, PRIZE_PLACES);
  const amounts = splitAmounts(pool, humans.length);
  return humans.map((player, i) => ({ place: i + 1, player, bps: PLACE_BPS[i], amount: amounts[i] }));
}

export type PrizeStanding = { player: string; total: number; net: number };

/**
 * Ranks humans for prizes: higher Total (balance + in play) first, then higher profit (net). The spec's last tie-break,
 * "earliest to reach the total", needs a per-player history of when each total was reached, which the board doesn't keep
 * yet; until it does, remaining ties keep the input order (Array.prototype.sort is stable), so pass rows oldest-first.
 */
export function rankForPrizes(rows: PrizeStanding[]): string[] {
  return rows
    .filter((r) => !isAnalyst(r.player))
    .slice()
    .sort((a, b) => b.total - a.total || b.net - a.net)
    .map((r) => r.player);
}
