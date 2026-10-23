// A market's pick batch in canonical form, so anyone can re-hash it and match the on-chain fingerprint.
import { createHash } from "node:crypto";

/** One bet: a player's choice in one market and the AXP staked on it (a whole number, at least 1). */
/** `lessons`: the Walrus Memory blob ids an analyst recalled for this pick (analysts only), so the fingerprint covers them. */
/** Market "title" is a daily "who wins Worlds" call: no AXP, so its stake is 0. */
/** `thought`: SHA-256 of the analyst's published reasoning and thinking summary (see thoughtHash), so neither can change after lock. */
export type BatchEntry = { player: string; market: "winner" | "score" | "title"; choice: string; stake: number; lessons?: string[]; thought?: string };

/** A stake that may appear in a batch: a whole, finite, non-negative number of AXP (0 only for title calls). */
export const isBatchStake = (stake: unknown): stake is number => typeof stake === "number" && Number.isInteger(stake) && stake >= 0;

/** Throws on any entry whose stake isn't a whole, non-negative AXP amount, so a bad stake never gets fingerprinted. */
export function assertStakes(entries: { player: string; stake: unknown }[]): void {
  const bad = entries.find((e) => !isBatchStake(e.stake));
  if (bad) throw new Error(`invalid stake ${String(bad.stake)} for ${bad.player}`);
}

export function canonicalBatch(matchId: string, entries: BatchEntry[]): string {
  assertStakes(entries);
  const sorted = [...entries]
    .sort((x, y) => x.player.localeCompare(y.player) || x.market.localeCompare(y.market) || x.choice.localeCompare(y.choice))
    .map(({ player, market, choice, stake, lessons, thought }) => ({
      player, market, choice, stake,
      ...(lessons?.length ? { lessons: [...lessons].sort() } : {}),
      ...(thought ? { thought } : {}),
    }));
  return JSON.stringify({ matchId, entries: sorted });
}

export const batchHash = (canonical: string) => createHash("sha256").update(canonical).digest("hex");

/** Fingerprint of an analyst's published reasoning and thinking summary: SHA-256 of JSON.stringify([reasoning, thinking]). */
export const thoughtHash = (reasoning: string, thinking: string) => createHash("sha256").update(JSON.stringify([reasoning, thinking])).digest("hex");
