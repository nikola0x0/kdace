// Season sponsorship: no prize pool exists yet; the leaderboard invites sponsors to get in touch.
import { PLACE_BPS } from "../../src/core/prizes.ts";

export const SPONSOR_EMAIL = "ltphat.developer@gmail.com";
export const SPONSOR_MAILTO = `mailto:${SPONSOR_EMAIL}?subject=${encodeURIComponent("Sponsoring KDAce at Worlds 2026")}`;

/** How a sponsored pool would be split across the top 20 fans, grouped the way it reads. */
export const PAYOUT_TIERS = [
  { label: "1st", from: 1, to: 1 },
  { label: "2nd", from: 2, to: 2 },
  { label: "3rd", from: 3, to: 3 },
  { label: "4th–5th", from: 4, to: 5 },
  { label: "6th–10th", from: 6, to: 10 },
  { label: "11th–20th", from: 11, to: 20 },
].map((t) => ({ ...t, bps: PLACE_BPS[t.from - 1] }));
