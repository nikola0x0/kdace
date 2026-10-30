// Per-series state in data/series/<matchId>.json and the board in data/board.json, committed to git (the file Store).
// RecordStore is the interface every job and the site go through; the file Store implements it, and so do MemoryStore
// (tests, snapshots) and SupabaseStore (src/core/supastore.ts, chosen with KDACE_STORE=supabase).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalystPick } from "./analysts.ts";
import type { Banter } from "./banter.ts";
import type { Graveyard } from "./graveyard.ts";
import type { Chain } from "./chain.ts";
import type { BatchEntry } from "./batch.ts";
import type { FinalCallEntry } from "./finalcall.ts";
import { AXP_START, marketNet, type BoardRow, type SettledSeries } from "./points.ts";
import type { ScoutData } from "./scoutstore.ts";
import type { TitleDay } from "./titles.ts";
import type { Series } from "./worlds.ts";

export type SeriesRecord = {
  series: Series;
  /** "void": no official result 48 h after the start (or cancelled); VOID was posted on chain and every stake refunded. */
  status: "committing" | "committed" | "settled" | "missed" | "void";
  picks: AnalystPick[];
  batch: string | null;
  batchHash: string | null;
  commitDigest: string | null;
  result: { winner: string; score: string; resultDigest: string } | null;
  /** Net AXP per player for this series (both markets, analysts and fans), written at settle. */
  axp: Record<string, number> | null;
  debate: string | null;
  lessons: { player: string; text: string; blobId: string; jobId?: string }[];
  /** Pre-game trash talk when the analysts split (flavour only, not fingerprinted). */
  banter?: Banter;
  /** The Scout stats digest every analyst saw for this matchup (official lolesports data), when there was one. */
  scout?: string;
  /** Set at commit; missing on records from before the switch to mainnet (see chainOf). */
  chain?: Chain;
  /** The first commit of this same batch on testnet, kept when the batch was re-committed on mainnet before its game. */
  testnetCommitDigest?: string;
  /** The fans' batch for this series, mirrored from Supabase by the tick (committed under `<matchId>:fans`). */
  fans?: FanSection;
  /** The analysts' final call (top-ups on their own side, shortly before lock), committed under `<matchId>:final`. */
  finalCall?: FinalCall;
};

/**
 * A series' final call. Recorded as "committing" (batch and hash) before the chain call, "committed" after; "none" when
 * nobody added (no chain call); "missed" when lock passed before the commit (its top-ups never count).
 */
export type FinalCall = {
  status: "committing" | "committed" | "none" | "missed";
  batch: string | null;
  batchHash: string | null;
  commitDigest: string | null;
  /** Set at commit, like SeriesRecord.chain. */
  chain?: Chain;
  calls: FinalCallEntry[];
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
/** Final-call top-ups that are on chain. */
const finalEntries = (r: SeriesRecord): BatchEntry[] => (r.finalCall?.status === "committed" ? batchEntries(r.finalCall.batch) : []);
/** Final-call top-ups that hold AXP back until settle: on chain, or on their way there. */
const finalOpenEntries = (r: SeriesRecord): BatchEntry[] => (r.finalCall?.status === "committed" || r.finalCall?.status === "committing" ? batchEntries(r.finalCall.batch) : []);
/** Every bet that is on chain: the analysts' batch once committed, their final-call top-ups once committed, and the fans' batch once committed. */
const allEntries = (r: SeriesRecord): BatchEntry[] => [...(r.commitDigest ? batchEntries(r.batch) : []), ...finalEntries(r), ...fanBatchEntries(r)];

/** A settled record in the shape the points module scores: analysts and fans share each market's pool. */
export const toSettled = (r: SeriesRecord): SettledSeries => ({
  matchId: r.series.matchId,
  bestOf: r.series.bestOf,
  entries: allEntries(r),
  result: { winner: r.result!.winner, score: r.result!.score },
});

/** A void series refunds everyone: net 0 for every player with a bet on chain. */
export const voidNet = (r: SeriesRecord): Record<string, number> => Object.fromEntries(allEntries(r).map((e) => [e.player, 0]));

/** Each player's net for a series with a result: parimutuel per market, or all zeros when it was voided. */
export const seriesNet = (r: SeriesRecord): Record<string, number> => (r.status === "void" ? voidNet(r) : marketNet(toSettled(r)));

/** Settled and void series are final: their nets count, and nothing in them is held back as open. */
export const isFinal = (r: SeriesRecord) => r.status === "settled" || r.status === "void";

export type AxpAccount = { start: number; settled: number; open: number; available: number };

/**
 * A player's AXP from the published records: settled = net over settled series; open = stakes in series that are
 * committed (or still committing) but not settled yet; available = start + settled − open. A record whose commit was
 * interrupted past lock is "missed": its analyst batch never reached the chain, so it holds nothing back. A void series
 * counts like a settled one (every net is 0).
 */
export function axpAccount(records: SeriesRecord[], player: string): AxpAccount {
  let settled = 0, open = 0;
  for (const r of records) {
    if (isFinal(r)) settled += r.axp?.[player] ?? 0;
    else for (const e of [...(r.status === "missed" ? [] : batchEntries(r.batch)), ...finalOpenEntries(r), ...fanBatchEntries(r)]) if (e.player === player) open += e.stake;
  }
  return { start: AXP_START, settled, open, available: AXP_START + settled - open };
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

/** A value, or a promise of one: the file and memory stores answer synchronously, SupabaseStore asynchronously. */
export type Awaitable<T> = T | Promise<T>;

/** Scout's files (data/scout/<key>.json): the three the analysts read, plus the run's meta. */
export const SCOUT_KEYS = ["series", "games", "teams", "meta"] as const;
export type ScoutKey = (typeof SCOUT_KEYS)[number];

/** Everything the site and verify read: every series record, the board, every title day and the fans' names. */
export type RecordsSnapshot = { series: SeriesRecord[]; board: BoardRow[]; titleDays: TitleDay[]; fanNames: Record<string, string | null>; graveyard?: Graveyard };

/**
 * Where the published records live. Jobs always `await` these calls, so a synchronous store (file, memory) and an
 * asynchronous one (Supabase) are interchangeable. `put` must never silently overwrite an update made in between.
 */
export interface RecordStore {
  get(matchId: string): Awaitable<SeriesRecord | null>;
  put(record: SeriesRecord): Awaitable<void>;
  all(): Awaitable<SeriesRecord[]>;
  writeBoard(rows: BoardRow[]): Awaitable<void>;
  readBoard(): Awaitable<BoardRow[]>;
  writeFanNames(names: Record<string, string | null>): Awaitable<void>;
  readFanNames(): Awaitable<Record<string, string | null>>;
  getTitleDay(date: string): Awaitable<TitleDay | null>;
  putTitleDay(day: TitleDay): Awaitable<void>;
  titleDays(): Awaitable<TitleDay[]>;
  writePending(rows: unknown[]): Awaitable<void>;
  /** The knocked-out teams' farewell roasts (team -> thread). */
  readGraveyard(): Awaitable<Graveyard>;
  writeGraveyard(g: Graveyard): Awaitable<void>;
  /** Scout's series, games and teams, or null until all three exist. */
  readScout(): Awaitable<ScoutData | null>;
  readScoutFile(key: ScoutKey): Awaitable<unknown | null>;
  writeScout(files: Partial<Record<ScoutKey, unknown>>): Awaitable<void>;
}

/** The synchronous reads the site and the pure checks use (file Store and MemoryStore). */
export type RecordReader = {
  get(matchId: string): SeriesRecord | null;
  all(): SeriesRecord[];
  readBoard(): BoardRow[];
  readFanNames(): Record<string, string | null>;
  titleDays(): TitleDay[];
  readGraveyard(): Graveyard;
};

/** A synchronous read-only view of records already loaded (e.g. `await store.all()`), for the pure selectors. */
export function viewOf(records: SeriesRecord[]): Pick<RecordReader, "get" | "all"> {
  const byId = new Map(records.map((r) => [r.series.matchId, r]));
  return { get: (matchId) => byId.get(matchId) ?? null, all: () => records };
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** A store held in memory (values copied in and out, like a real store): tests, and snapshots read from Supabase or /api/records. */
export class MemoryStore implements RecordStore, RecordReader {
  series = new Map<string, SeriesRecord>();
  days = new Map<string, TitleDay>();
  board: BoardRow[] = [];
  fanNames: Record<string, string | null> = {};
  pending: unknown[] = [];
  scout: Partial<Record<ScoutKey, unknown>> = {};
  graveyard: Graveyard = {};

  static from(snap: RecordsSnapshot): MemoryStore {
    const st = new MemoryStore();
    for (const r of snap.series) st.put(r);
    for (const d of snap.titleDays) st.putTitleDay(d);
    st.writeBoard(snap.board);
    st.writeFanNames(snap.fanNames ?? {});
    st.writeGraveyard(snap.graveyard ?? {});
    return st;
  }

  get(matchId: string): SeriesRecord | null {
    return clone(this.series.get(matchId) ?? null);
  }
  put(record: SeriesRecord): void {
    this.series.set(record.series.matchId, clone(record));
  }
  all(): SeriesRecord[] {
    return [...this.series.values()].map(clone);
  }
  writeBoard(rows: BoardRow[]): void {
    this.board = clone(rows);
  }
  readBoard(): BoardRow[] {
    return clone(this.board);
  }
  writeFanNames(names: Record<string, string | null>): void {
    this.fanNames = clone(names);
  }
  readFanNames(): Record<string, string | null> {
    return clone(this.fanNames);
  }
  getTitleDay(date: string): TitleDay | null {
    return clone(this.days.get(date) ?? null);
  }
  putTitleDay(day: TitleDay): void {
    this.days.set(day.date, clone(day));
  }
  titleDays(): TitleDay[] {
    return [...this.days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(clone);
  }
  writePending(rows: unknown[]): void {
    this.pending = clone(rows);
  }
  readGraveyard(): Graveyard {
    return clone(this.graveyard);
  }
  writeGraveyard(g: Graveyard): void {
    this.graveyard = clone(g);
  }
  readScout(): ScoutData | null {
    const { series, games, teams } = this.scout;
    return series && games && teams ? clone({ series, games, teams } as ScoutData) : null;
  }
  readScoutFile(key: ScoutKey): unknown | null {
    return clone(this.scout[key] ?? null);
  }
  writeScout(files: Partial<Record<ScoutKey, unknown>>): void {
    this.scout = { ...this.scout, ...clone(files) };
  }
}

export class Store implements RecordStore, RecordReader {
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

  /** Records still awaiting a result (data/pending.json), read by the lock route's tick dispatcher from GitHub. */
  writePending(rows: unknown[]): void {
    writeJson(join(this.dir, "pending.json"), rows);
  }

  readBoard(): BoardRow[] {
    const path = join(this.dir, "board.json");
    return existsSync(path) ? readJson(path) : [];
  }

  /** The knocked-out teams' farewell roasts (data/graveyard.json). */
  readGraveyard(): Graveyard {
    const path = join(this.dir, "graveyard.json");
    return existsSync(path) ? readJson(path) : {};
  }

  writeGraveyard(g: Graveyard): void {
    writeJson(join(this.dir, "graveyard.json"), g);
  }

  /** Scout's data in data/scout/, as `npm run scout` writes it (one-space indent). */
  readScout(): ScoutData | null {
    const [series, games, teams] = (["series", "games", "teams"] as const).map((k) => this.readScoutFile(k));
    return series && games && teams ? ({ series, games, teams } as ScoutData) : null;
  }

  readScoutFile(key: ScoutKey): unknown | null {
    const path = join(this.dir, "scout", `${key}.json`);
    return existsSync(path) ? readJson(path) : null;
  }

  writeScout(files: Partial<Record<ScoutKey, unknown>>): void {
    mkdirSync(join(this.dir, "scout"), { recursive: true });
    for (const [key, value] of Object.entries(files)) writeFileSync(join(this.dir, "scout", `${key}.json`), JSON.stringify(value, null, 1) + "\n");
  }
}
