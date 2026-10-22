// Season prize pool showcase. A preview of the design only: nothing here is live and no money moves.
// The split itself lives in src/core/prizes.ts (mirrors move/sources/prize_pool.move).
import { PLACE_BPS, prizeSplit, rankForPrizes, type PrizeStanding } from "../../src/core/prizes.ts";

/** Showcase pool size in cents ($10,000). Cents keep the split exact, the same way Move works in base units. */
export const PREVIEW_POOL_CENTS = 1_000_000;

/** Sponsor slots shown under "Prize pool by". Empty until a real sponsor signs; each renders as an open slot. */
export const SPONSORS: { name: string; amountCents: number; logo?: string }[] = [];
export const SPONSOR_SLOTS = 3;

/** Contact placeholder: opens the mail app with a subject and no recipient until a sponsor inbox exists. */
export const SPONSOR_MAILTO = "mailto:?subject=" + encodeURIComponent("Sponsoring the KDAce Worlds 2026 prize pool");

export function usd(cents: number): string {
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

/** The payout table, grouped the way it reads: 1st, 2nd, 3rd, 4th–5th, 6th–10th, 11th–20th. */
export const PAYOUT_TIERS = [
  { label: "1st", from: 1, to: 1 },
  { label: "2nd", from: 2, to: 2 },
  { label: "3rd", from: 3, to: 3 },
  { label: "4th–5th", from: 4, to: 5 },
  { label: "6th–10th", from: 6, to: 10 },
  { label: "11th–20th", from: 11, to: 20 },
].map((t) => ({ ...t, bps: PLACE_BPS[t.from - 1], cents: (PREVIEW_POOL_CENTS * PLACE_BPS[t.from - 1]) / 10_000 }));

/** Projected prize (cents) per human player if the season ended now. Analysts never take a place. */
export function projectedPrizes(rows: PrizeStanding[]): Map<string, { place: number; cents: number }> {
  return new Map(prizeSplit(PREVIEW_POOL_CENTS, rankForPrizes(rows)).map((s) => [s.player, { place: s.place, cents: s.amount }]));
}
