// Fan pick rules: same markets and valid scores as the analysts, last pick before lock counts.
// Dependency-free so the web app's API routes can import it.
import { VALID_SCORES } from "./analysts.ts";
import type { BatchEntry } from "./batch.ts";
import { isLocked, LOCK_MARGIN_MS } from "./select.ts";
import type { Series } from "./worlds.ts";

export type FanMarket = "winner" | "score";

/** One fan's current pick in one market, as stored in Supabase. `updatedAt` is server time. */
export type FanPickRow = { matchId: string; address: string; market: FanMarket; choice: string; updatedAt: string };

export const FAN_PREFIX = "fan:";
export const fanPlayer = (address: string) => `${FAN_PREFIX}${address}`;
/** Fan batches are committed under their own market id, next to the analysts' `<matchId>`. */
export const fanMarketId = (matchId: string) => `${matchId}:fans`;
export const lockAt = (startTime: string) => new Date(Date.parse(startTime) - LOCK_MARGIN_MS).toISOString();

const choiceError = (s: Series, market: string, choice: string): string | null => {
  if (market === "winner") return choice === s.teamA || choice === s.teamB ? null : `winner must be ${s.teamA} or ${s.teamB}`;
  if (market === "score") {
    if (s.bestOf === 1) return "Bo1 series have no score market";
    return VALID_SCORES[s.bestOf].includes(choice) ? null : `score must be one of ${VALID_SCORES[s.bestOf].join(", ")}`;
  }
  return `unknown market ${market}`;
};

/** Why a pick can't be accepted now, or null when it can. */
export function validateFanPick(s: Series | undefined, market: string, choice: string, now: Date): string | null {
  if (!s) return "unknown series";
  if (s.teamA === "TBD" || s.teamB === "TBD") return "teams are not known yet";
  if (s.state !== "unstarted" || isLocked(s.startTime, now)) return `picks locked at ${lockAt(s.startTime)}`;
  return choiceError(s, market, choice);
}

/** The batch entries for a series: picks for this match, made before lock, still valid. */
export function fanEntries(s: Series, rows: FanPickRow[]): BatchEntry[] {
  const lock = Date.parse(lockAt(s.startTime));
  return rows
    .filter((r) => r.matchId === s.matchId && Date.parse(r.updatedAt) < lock && choiceError(s, r.market, r.choice) === null)
    .map((r) => ({ player: fanPlayer(r.address), market: r.market, choice: r.choice }));
}

export function crowdSplit(s: Series, rows: FanPickRow[]) {
  const mine = rows.filter((r) => r.matchId === s.matchId);
  const winner: Record<string, number> = { [s.teamA]: 0, [s.teamB]: 0 };
  const score: Record<string, number> = {};
  for (const r of mine) {
    if (r.market === "winner" && r.choice in winner) winner[r.choice]++;
    if (r.market === "score" && s.bestOf > 1) score[r.choice] = (score[r.choice] ?? 0) + 1;
  }
  return { fans: new Set(mine.map((r) => r.address)).size, winner, score };
}

/** What a fan keeps to check later that their pick is inside the committed batch. */
export function pickReceipt(s: Series, r: FanPickRow) {
  const marketId = fanMarketId(s.matchId);
  return {
    entry: { player: fanPlayer(r.address), market: r.market, choice: r.choice } as BatchEntry,
    marketId,
    lockAt: lockAt(s.startTime),
    pickedAt: r.updatedAt,
    howToCheck: `At lock, every final fan pick is bundled as canonicalBatch("${marketId}", entries) (src/core/batch.ts: JSON {matchId, entries} sorted by player then market) and its SHA-256 is committed on Sui under market id "${marketId}". Your entry must appear in the batch published in data/series/${s.matchId}.json (fans.batch) if it is still your last pick at lock.`,
  };
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A fan's name wherever they appear: their default SuiNS name, else a shortened address. */
export const displayName = (addressOrPlayer: string, suinsName?: string | null) =>
  suinsName || shortAddress(addressOrPlayer.startsWith(FAN_PREFIX) ? addressOrPlayer.slice(FAN_PREFIX.length) : addressOrPlayer);
