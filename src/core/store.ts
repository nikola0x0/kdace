// Per-series state in data/series/<matchId>.json and the board in data/board.json, committed to git.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalystPick } from "./analysts.ts";
import type { Chain } from "./chain.ts";
import type { BatchEntry } from "./batch.ts";
import type { BoardRow, SettledSeries } from "./points.ts";
import type { Series } from "./worlds.ts";

export type SeriesRecord = {
  series: Series;
  status: "committing" | "committed" | "settled" | "missed";
  picks: AnalystPick[];
  batch: string | null;
  batchHash: string | null;
  commitDigest: string | null;
  result: { winner: string; score: string; resultDigest: string } | null;
  points: Record<string, number> | null;
  debate: string | null;
  lessons: { player: string; text: string; blobId: string; jobId?: string }[];
  /** Set at commit; missing on records from before the switch to mainnet (see chainOf). */
  chain?: Chain;
  /** The first commit of this same batch on testnet, kept when the batch was re-committed on mainnet before its game. */
  testnetCommitDigest?: string;
  /** The fans' batch for this series, mirrored from Supabase by the tick (committed under `<matchId>:fans`). */
  fans?: FanSection;
};

/** A fan batch as committed at lock: the canonical batch, its hash, and where it went on chain. */
export type FanSection = {
  status: "committed" | "missed";
  batch: string | null;
  batchHash: string | null;
  pickCount: number;
  commitDigest: string | null;
  committedAt: string | null;
  chain: Chain;
};

const batchEntries = (batch: string | null): BatchEntry[] => (batch ? (JSON.parse(batch) as { entries: BatchEntry[] }).entries : []);

/** A settled record in the shape the points module scores: analysts and fans share each market's pot. */
export const toSettled = (r: SeriesRecord): SettledSeries => ({
  matchId: r.series.matchId,
  bestOf: r.series.bestOf,
  entries: [...batchEntries(r.batch), ...(r.fans?.status === "committed" ? batchEntries(r.fans.batch) : [])],
  result: { winner: r.result!.winner, score: r.result!.score },
});

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

export class Store {
  private seriesDir: string;

  constructor(private dir = "data") {
    this.seriesDir = join(dir, "series");
    mkdirSync(this.seriesDir, { recursive: true });
  }

  get(matchId: string): SeriesRecord | null {
    const path = join(this.seriesDir, `${matchId}.json`);
    return existsSync(path) ? readJson(path) : null;
  }

  put(record: SeriesRecord): void {
    writeJson(join(this.seriesDir, `${record.series.matchId}.json`), record);
  }

  all(): SeriesRecord[] {
    return readdirSync(this.seriesDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson<SeriesRecord>(join(this.seriesDir, f)));
  }

  writeBoard(rows: BoardRow[]): void {
    writeJson(join(this.dir, "board.json"), rows);
  }

  readBoard(): BoardRow[] {
    const path = join(this.dir, "board.json");
    return existsSync(path) ? readJson(path) : [];
  }
}
