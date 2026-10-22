// Pure verification checks: anyone can re-run these against chain data and the published records.
import { batchHash, canonicalBatch } from "./batch.ts";
import { FAN_PREFIX, fanMarketId } from "./fans.ts";
import { computeBoard } from "./points.ts";
import { toSettled, type SeriesRecord, type Store } from "./store.ts";
import type { Series } from "./worlds.ts";

type LedgerEvent = { type: "BatchCommitted" | "ResultPosted"; json: Record<string, unknown> } | null;

const hashHex = (raw: unknown): string =>
  Array.isArray(raw) ? Buffer.from(raw as number[]).toString("hex") : typeof raw === "string" ? Buffer.from(raw, "base64").toString("hex") : "";

/** The picks shown to people must be exactly the ones that were hashed. */
function picksMatchBatch(r: SeriesRecord): boolean {
  if (!r.batch) return false;
  const shown = canonicalBatch(r.series.matchId, r.picks.flatMap((p) => [
    { player: p.player, market: "winner" as const, choice: p.winner },
    ...(r.series.bestOf > 1 && p.score ? [{ player: p.player, market: "score" as const, choice: p.score }] : []),
  ]));
  return shown === r.batch;
}

/**
 * Checks one series against the chain (`commit`, `result`, read through Tatum) and the official lolesports feed (`official`).
 * Limit: Tatum's gRPC blocks event listing, so a second commit for the same match cannot be detected from here.
 */
export function checkRecord(r: SeriesRecord, commit: LedgerEvent, result: LedgerEvent, official: Series | undefined) {
  const matchId = r.series.matchId;
  const commitOk = commit?.type === "BatchCommitted" && commit.json.market_id === matchId;
  const resultOk = result?.type === "ResultPosted" && result.json.market_id === matchId;
  const onchain = commitOk ? hashHex(commit!.json.batch_hash) : "";
  const officialScore = official && official.winner ? `${Math.max(official.winsA ?? 0, official.winsB ?? 0)}-${Math.min(official.winsA ?? 0, official.winsB ?? 0)}` : null;
  return {
    hashMatches: commitOk && !!r.batch && JSON.parse(r.batch).matchId === matchId && onchain === batchHash(r.batch) && onchain === r.batchHash,
    picksMatchBatch: picksMatchBatch(r),
    committedBeforeStart: commitOk && !!official && Number(commit!.json.committed_at_ms) < Date.parse(official.startTime),
    resultMatchesOfficial: resultOk && !!official?.winner && result!.json.winner === official.winner && result!.json.score === officialScore,
    lessonsPredatePicks: r.picks.every((p) => p.usedLessons.every((l) => Date.parse(l.createdAt) < Date.parse(p.pickedAt))),
  };
}

/**
 * Checks a series' fan batch: the on-chain fingerprint under `<matchId>:fans` matches the published batch, the batch
 * only holds fan entries, and the commit landed before the official start (fans lock 5 minutes before it).
 */
export function checkFans(r: SeriesRecord, commit: LedgerEvent, official: Series | undefined) {
  const marketId = fanMarketId(r.series.matchId);
  const f = r.fans;
  const commitOk = !!f?.batch && commit?.type === "BatchCommitted" && commit.json.market_id === marketId;
  const onchain = commitOk ? hashHex(commit!.json.batch_hash) : "";
  const parsed = f?.batch ? (JSON.parse(f.batch) as { matchId: string; entries: { player: string }[] }) : null;
  return {
    fanHashMatches: commitOk && parsed!.matchId === marketId && onchain === batchHash(f!.batch!) && onchain === f!.batchHash,
    fanEntriesAreFans: !!parsed && parsed.entries.every((e) => e.player.startsWith(FAN_PREFIX)),
    fanCommittedBeforeStart: commitOk && !!official && Number(commit!.json.committed_at_ms) < Date.parse(official.startTime),
  };
}

export function boardMatches(store: Store): boolean {
  const recomputed = computeBoard(store.all().filter((r) => r.status === "settled").map(toSettled));
  return JSON.stringify(recomputed) === JSON.stringify(store.readBoard());
}
