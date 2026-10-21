// Per-series state in data/series/<matchId>.json and the board in data/board.json, committed to git.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalystPick } from "./analysts.ts";
import type { BoardRow } from "./points.ts";
import type { Series } from "./worlds.ts";

export type SeriesRecord = {
  series: Series;
  status: "committed" | "settled" | "missed";
  picks: AnalystPick[];
  batch: string | null;
  batchHash: string | null;
  commitDigest: string | null;
  result: { winner: string; score: string; resultDigest: string } | null;
  points: Record<string, number> | null;
  debate: string | null;
  lessons: { player: string; text: string; blobId: string }[];
};

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
