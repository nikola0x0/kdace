// Pure verification checks: anyone can re-run these against chain data and the published records.
import { analystEntries, MIN_STAKE } from "./analysts.ts";
import { batchHash, canonicalBatch, type BatchEntry } from "./batch.ts";
import { finalCallEntries, finalMarketId } from "./finalcall.ts";
import { FAN_PREFIX, fanMarketId } from "./fans.ts";
import { computeBoard } from "./points.ts";
import { VOID } from "./results.ts";
import { seriesNet, toSettled, voidNet, type SeriesRecord, type Store } from "./store.ts";
import { titleMarketId, type TitleDay } from "./titles.ts";
import type { Series } from "./worlds.ts";

type LedgerEvent = { type: "BatchCommitted" | "ResultPosted"; json: Record<string, unknown> } | null;

/** Runs a check that parses or recomputes published data; malformed data fails the check instead of crashing verify. */
const safely = (f: () => boolean): boolean => {
  try {
    return f();
  } catch {
    return false;
  }
};

const hashHex = (raw: unknown): string =>
  Array.isArray(raw) ? Buffer.from(raw as number[]).toString("hex") : typeof raw === "string" ? Buffer.from(raw, "base64").toString("hex") : "";

/** The picks and stakes shown to people must be exactly the ones that were hashed. */
function picksMatchBatch(r: SeriesRecord): boolean {
  if (!r.batch) return false;
  return safely(() => canonicalBatch(r.series.matchId, analystEntries(r.series.bestOf, r.picks)) === r.batch);
}

/** The deadline a commit must beat: the start stored at commit, or the official start if it has since moved earlier. */
const startDeadline = (r: SeriesRecord, official: Series | undefined) => Math.min(Date.parse(r.series.startTime), official ? Date.parse(official.startTime) : Infinity);

/** A plain note when the official start differs from the one stored at commit (null when it doesn't, or isn't listed). */
export function startShift(r: SeriesRecord, official: Series | undefined): string | null {
  if (!official) return null;
  const mins = Math.round((Date.parse(official.startTime) - Date.parse(r.series.startTime)) / 60000);
  if (!mins) return null;
  return `official start moved ${Math.abs(mins)} min ${mins < 0 ? "earlier" : "later"} than the ${r.series.startTime} stored at commit; commits are checked against the earlier of the two`;
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
    committedBeforeStart: commitOk && Number(commit!.json.committed_at_ms) < startDeadline(r, official),
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
    fanCommittedBeforeStart: commitOk && Number(commit!.json.committed_at_ms) < startDeadline(r, official),
  };
}

/**
 * Checks a series' final call: the on-chain fingerprint under `<matchId>:final` is the published batch, it landed before
 * the start, its entries are exactly the published calls that added AXP, and every top-up is a winner bet of at least
 * 10 AXP on the side that analyst originally picked.
 */
export function checkFinalCall(r: SeriesRecord, commit: LedgerEvent, official: Series | undefined) {
  const marketId = finalMarketId(r.series.matchId);
  const f = r.finalCall;
  const commitOk = !!f?.batch && commit?.type === "BatchCommitted" && commit.json.market_id === marketId;
  const onchain = commitOk ? hashHex(commit!.json.batch_hash) : "";
  const parsed = safelyParse(f?.batch);
  return {
    finalHashMatches: commitOk && parsed?.matchId === marketId && onchain === batchHash(f!.batch!) && onchain === f!.batchHash,
    finalCommittedBeforeStart: commitOk && Number(commit!.json.committed_at_ms) < startDeadline(r, official),
    finalEntriesMatchCalls: !!f?.batch && safely(() => canonicalBatch(marketId, finalCallEntries(r.picks, f.calls)) === f.batch),
    finalOnOriginalSide: !!parsed && parsed.entries.length > 0 && parsed.entries.every((e) => {
      const pick = r.picks.find((p) => p.player === e.player);
      return !!pick && e.market === "winner" && e.choice === pick.winner && Number.isInteger(e.stake) && e.stake >= MIN_STAKE;
    }),
  };
}

const safelyParse = (batch: string | null | undefined): { matchId: string; entries: BatchEntry[] } | null => {
  try {
    return batch ? JSON.parse(batch) : null;
  } catch {
    return null;
  }
};

/** A day's title calls: the on-chain fingerprint is this exact batch, committed on that UTC day, one entry per analyst call. */
export function checkTitleDay(day: TitleDay, commit: LedgerEvent) {
  const marketId = titleMarketId(day.date);
  const commitOk = commit?.type === "BatchCommitted" && commit.json.market_id === marketId;
  const onchain = commitOk ? hashHex(commit!.json.batch_hash) : "";
  const parsed = JSON.parse(day.batch) as { matchId: string; entries: { player: string; market: string; choice: string }[] };
  const calls = new Map(day.picks.map((p) => [p.player, p.champion]));
  return {
    titleHashMatches: commitOk && parsed.matchId === marketId && onchain === batchHash(day.batch) && onchain === day.batchHash,
    titleCommittedThatDay: commitOk && new Date(Number(commit!.json.committed_at_ms)).toISOString().slice(0, 10) === day.date,
    titleEntriesMatchCalls: parsed.entries.length === calls.size && parsed.entries.every((e) => e.market === "title" && calls.get(e.player) === e.choice),
  };
}

/** A void series: VOID/VOID posted on chain for this match (as published), and every player with a bet on chain refunded (net 0). */
export function checkVoid(r: SeriesRecord, result: LedgerEvent) {
  const resultOk = result?.type === "ResultPosted" && result.json.market_id === r.series.matchId;
  return {
    voidResultOnChain: resultOk && result!.json.winner === VOID && result!.json.score === VOID && r.result?.winner === VOID && r.result?.score === VOID,
    voidRefundsAll: !!r.axp && safely(() => JSON.stringify(Object.entries(voidNet(r)).sort()) === JSON.stringify(Object.entries(r.axp!).sort())),
  };
}

/** A settled record's AXP results must be exactly what its published batches (analysts and fans) pay out; a void one refunds all. */
export function axpMatches(r: SeriesRecord): boolean {
  if (!r.result || !r.axp) return false;
  const sorted = (o: Record<string, number>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return safely(() => sorted(seriesNet(r)) === sorted(r.axp!));
}

/** The leaderboard must be exactly what the settled records' published batches add up to. */
export function boardMatches(store: Store): boolean {
  return safely(() => JSON.stringify(computeBoard(store.all().filter((r) => r.status === "settled").map(toSettled))) === JSON.stringify(store.readBoard()));
}
