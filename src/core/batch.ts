// A market's pick batch in canonical form, so anyone can re-hash it and match the on-chain fingerprint.
import { createHash } from "node:crypto";

/** One bet: a player's choice in one market and the AXP staked on it (a whole number, at least 1). */
export type BatchEntry = { player: string; market: "winner" | "score"; choice: string; stake: number };

export function canonicalBatch(matchId: string, entries: BatchEntry[]): string {
  const sorted = [...entries]
    .sort((x, y) => x.player.localeCompare(y.player) || x.market.localeCompare(y.market))
    .map(({ player, market, choice, stake }) => ({ player, market, choice, stake }));
  return JSON.stringify({ matchId, entries: sorted });
}

export const batchHash = (canonical: string) => createHash("sha256").update(canonical).digest("hex");
