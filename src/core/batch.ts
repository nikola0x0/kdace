// A market's pick batch in canonical form, so anyone can re-hash it and match the on-chain fingerprint.
import { createHash } from "node:crypto";

/** One bet: a player's choice in one market and the AXP staked on it (a whole number, at least 1). */
/** `lessons`: the Walrus Memory blob ids an analyst recalled for this pick (analysts only), so the fingerprint covers them. */
/** Market "title" is a daily "who wins Worlds" call: no AXP, so its stake is 0. */
export type BatchEntry = { player: string; market: "winner" | "score" | "title"; choice: string; stake: number; lessons?: string[] };

export function canonicalBatch(matchId: string, entries: BatchEntry[]): string {
  const sorted = [...entries]
    .sort((x, y) => x.player.localeCompare(y.player) || x.market.localeCompare(y.market) || x.choice.localeCompare(y.choice))
    .map(({ player, market, choice, stake, lessons }) => (lessons?.length ? { player, market, choice, stake, lessons: [...lessons].sort() } : { player, market, choice, stake }));
  return JSON.stringify({ matchId, entries: sorted });
}

export const batchHash = (canonical: string) => createHash("sha256").update(canonical).digest("hex");
