// A market's pick batch in canonical form, so anyone can re-hash it and match the on-chain fingerprint.
import { createHash } from "node:crypto";

export type BatchEntry = { player: string; market: "winner" | "score"; choice: string };

export function canonicalBatch(matchId: string, entries: BatchEntry[]): string {
  const sorted = [...entries]
    .sort((x, y) => x.player.localeCompare(y.player) || x.market.localeCompare(y.market))
    .map(({ player, market, choice }) => ({ player, market, choice }));
  return JSON.stringify({ matchId, entries: sorted });
}

export const batchHash = (canonical: string) => createHash("sha256").update(canonical).digest("hex");
