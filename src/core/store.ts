// Per-series state in data/series/<matchId>.json and the board in data/board.json, committed to git.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalystPick } from "./analysts.ts";
import type { Chain } from "./chain.ts";
import type { BatchEntry } from "./batch.ts";
import { AXP_START, type BoardRow, type SettledSeries } from "./points.ts";
import type { TitleDay } from "./titles.ts";
import type { Series } from "./worlds.ts";

export type SeriesRecord = {
  series: Series;
  status: "committing" | "committed" | "settled" | "missed";
  picks: AnalystPick[];
  batch: string | null;
  batchHash: string | null;
  commitDigest: string | null;
  result: { winner: string; score: string; resultDigest: string } | null;
  /** Net AXP per player for this series (both markets, analysts and fans), written at settle. */
  axp: Record<string, number> | null;
  debate: string | null;
  lessons: { player: string; text: string; blobId: string; jobId?: string }[];
  /** The Scout stats digest every analyst saw for this matchup (official lolesports data), when there was one. */
  scout?: string;
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

const fanBatchEntries = (r: SeriesRecord): BatchEntry[] => (r.fans?.status === "committed" ? batchEntries(r.fans.batch) : []);
/** Every bet that is on chain: the analysts' batch once committed, and the fans' batch once committed. */
const allEntries = (r: SeriesRecord): BatchEntry[] => [...(r.commitDigest ? batchEntries(r.batch) : []), ...fanBatchEntries(r)];

/** A settled record in the shape the points module scores: analysts and fans share each market's pool. */
export const toSettled = (r: SeriesRecord): SettledSeries => ({
  matchId: r.series.matchId,
  bestOf: r.series.bestOf,
  entries: allEntries(r),
  result: { winner: r.result!.winner, score: r.result!.score },
});

export type AxpAccount = { start: number; settled: number; open: number; available: number };

/**
 * A player's AXP from the published records: settled = net over settled series; open = stakes in series that are
 * committed (or still committing) but not settled yet; available = start + settled − open. A record whose commit was
 * interrupted past lock is "missed": its analyst batch never reached the chain, so it holds nothing back.
 */
export function axpAccount(records: SeriesRecord[], player: string): AxpAccount {
  let settled = 0, open = 0;
  for (const r of records) {
    if (r.status === "settled") settled += r.axp?.[player] ?? 0;
    else for (const e of [...(r.status === "missed" ? [] : batchEntries(r.batch)), ...fanBatchEntries(r)]) if (e.player === player) open += e.stake;
  }
  return { start: AXP_START, settled, open, available: AXP_START + settled - open };
}

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

  /** Fans' SuiNS names (address → name or null), copied from Supabase so the static site can show them. */
  writeFanNames(names: Record<string, string | null>): void {
    writeJson(join(this.dir, "fans.json"), names);
  }

  readFanNames(): Record<string, string | null> {
    const path = join(this.dir, "fans.json");
    return existsSync(path) ? readJson(path) : {};
  }

  /** Daily title picks, one file per UTC day (data/titles/<YYYY-MM-DD>.json). */
  getTitleDay(date: string): TitleDay | null {
    const path = join(this.dir, "titles", `${date}.json`);
    return existsSync(path) ? readJson(path) : null;
  }

  putTitleDay(day: TitleDay): void {
    mkdirSync(join(this.dir, "titles"), { recursive: true });
    writeJson(join(this.dir, "titles", `${day.date}.json`), day);
  }

  /** Every title day, oldest first. */
  titleDays(): TitleDay[] {
    const dir = join(this.dir, "titles");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => readJson<TitleDay>(join(dir, f)));
  }

  readBoard(): BoardRow[] {
    const path = join(this.dir, "board.json");
    return existsSync(path) ? readJson(path) : [];
  }
}
