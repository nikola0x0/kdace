// Pure verification checks: anyone can re-run these against chain data and the published records.
import { batchHash } from "./batch.ts";
import { computeBoard } from "./points.ts";
import { toSettled, type SeriesRecord, type Store } from "./store.ts";

type EventJson = { json: Record<string, unknown> } | null;

const hashHex = (raw: unknown): string =>
  Array.isArray(raw) ? Buffer.from(raw as number[]).toString("hex") : typeof raw === "string" ? Buffer.from(raw, "base64").toString("hex") : "";

export function checkRecord(r: SeriesRecord, commit: EventJson, result: EventJson) {
  const onchain = hashHex(commit?.json.batch_hash);
  return {
    hashMatches: !!r.batch && onchain === batchHash(r.batch) && onchain === r.batchHash,
    committedBeforeStart: !!commit && Number(commit.json.committed_at_ms) < Date.parse(r.series.startTime),
    resultMatchesOfficial:
      !!result && !!r.result && result.json.winner === r.result.winner && result.json.score === r.result.score && r.result.winner === r.series.winner,
    lessonsPredatePicks: r.picks.every((p) => p.usedLessons.every((l) => Date.parse(l.createdAt) < Date.parse(p.pickedAt))),
  };
}

export function boardMatches(store: Store): boolean {
  const recomputed = computeBoard(store.all().filter((r) => r.status === "settled").map(toSettled));
  return JSON.stringify(recomputed) === JSON.stringify(store.readBoard());
}
