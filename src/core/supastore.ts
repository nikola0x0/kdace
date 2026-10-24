// The published records in Supabase (tables from supabase/migrations/20261024000000_records.sql), over its REST API
// (PostgREST): a RecordStore for the jobs and the site, and the runner's lock and per-stage state. Server-side only (the
// service role key). Dependency-free (uses fetch). Chosen with KDACE_STORE=supabase; the file Store stays the default.
//
// No lost updates: every series record and title day carries a version. `put` only replaces the version this instance
// last read (one conditional UPDATE), or inserts when it saw none; anything else throws StoreConflictError, and the job
// retries on its next run. A network error or 5xx is retried; a write that landed but whose response was lost is
// recognised (the row holds exactly what was written, at the next version) instead of being reported as a conflict.
import { Store, SCOUT_KEYS, type RecordStore, type RecordsSnapshot, type ScoutKey, type SeriesRecord } from "./store.ts";
import type { BoardRow } from "./points.ts";
import type { ScoutData } from "./scoutstore.ts";
import type { TitleDay } from "./titles.ts";

/** Another writer changed (or created) the row since this instance read it; nothing was written. */
export class StoreConflictError extends Error {}

type RestOptions = { timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void> };

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const eq = (v: string) => `eq.${encodeURIComponent(v)}`;
const inList = (vs: readonly string[]) => `in.(${vs.map((v) => encodeURIComponent(`"${v}"`)).join(",")})`;

/** PostgREST requests with a timeout, and retries for network errors, 429 and 5xx (fail fast: a few seconds, then throw). */
export class SupabaseRest {
  private timeoutMs: number;
  private retries: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(private url: string, private key: string, private fetchImpl: typeof fetch = fetch, opts: RestOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.retries = opts.retries ?? 2;
    this.sleep = opts.sleep ?? realSleep;
  }

  /** 409 is returned to the caller (a duplicate key); any other error status throws. */
  async req(method: string, path: string, body?: unknown, prefer?: string): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { apikey: this.key, "Content-Type": "application/json" };
    // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys must not.
    if (this.key.startsWith("eyJ")) headers.Authorization = `Bearer ${this.key}`;
    if (prefer) headers.Prefer = prefer;
    const target = `${this.url.replace(/\/$/, "")}/rest/v1/${path}`;
    for (let attempt = 0; ; attempt++) {
      let failure: Error;
      try {
        const res = await this.fetchImpl(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(this.timeoutMs) });
        const text = await res.text();
        const json = text ? JSON.parse(text) : null;
        if (res.ok || res.status === 409) return { status: res.status, json };
        failure = new Error(`Supabase ${method} ${path.split("?")[0]} HTTP ${res.status}: ${json?.message ?? text}`);
        if (res.status !== 429 && res.status < 500) throw failure;
      } catch (e) {
        if ((e as Error).message.startsWith("Supabase ")) throw e;
        failure = e as Error;
      }
      if (attempt >= this.retries) throw failure;
      await this.sleep(500 * 3 ** attempt);
    }
  }
}

/** Order-insensitive JSON for comparing what was written with what is stored. */
export const canonicalJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

type Versioned = { table: string; keyCol: string; valCol: string; tag: string };
const SERIES: Versioned = { table: "series_records", keyCol: "match_id", valCol: "record", tag: "s:" };
const DAYS: Versioned = { table: "title_days", keyCol: "date", valCol: "day", tag: "t:" };

export class SupabaseStore implements RecordStore {
  /** The version this instance last read or wrote for each row (0: read, and it didn't exist). */
  private versions = new Map<string, number>();

  constructor(private rest: SupabaseRest) {}

  private track(t: Versioned, key: string, version: number) {
    this.versions.set(t.tag + key, version);
  }

  private async readVersioned<T>(t: Versioned, key?: string): Promise<T[]> {
    const filter = key === undefined ? "" : `&${t.keyCol}=${eq(key)}`;
    const { json } = await this.rest.req("GET", `${t.table}?select=${t.keyCol},${t.valCol},version${filter}&order=${t.keyCol}.asc`);
    const rows = json as Record<string, unknown>[];
    if (key !== undefined && !rows.length) this.track(t, key, 0);
    for (const r of rows) this.track(t, String(r[t.keyCol]), Number(r.version));
    return rows.map((r) => r[t.valCol] as T);
  }

  /** True when the row holds exactly `value` at `version` (our write landed, its response was lost). */
  private async landed(t: Versioned, key: string, value: unknown, version: number): Promise<boolean> {
    const { json } = await this.rest.req("GET", `${t.table}?select=${t.valCol},version&${t.keyCol}=${eq(key)}`);
    const row = (json as Record<string, unknown>[])[0];
    return !!row && Number(row.version) === version && canonicalJson(row[t.valCol]) === canonicalJson(value);
  }

  private async writeVersioned(t: Versioned, key: string, value: unknown): Promise<void> {
    const seen = this.versions.get(t.tag + key) ?? 0;
    const next = seen + 1;
    const updatedAt = new Date().toISOString();
    let ok: boolean;
    if (seen === 0) {
      const { status } = await this.rest.req("POST", t.table, { [t.keyCol]: key, [t.valCol]: value, version: 1, updated_at: updatedAt }, "return=minimal");
      ok = status !== 409 || (await this.landed(t, key, value, 1));
    } else {
      const { json } = await this.rest.req("PATCH", `${t.table}?${t.keyCol}=${eq(key)}&version=eq.${seen}`, { [t.valCol]: value, version: next, updated_at: updatedAt }, "return=representation");
      ok = (Array.isArray(json) && json.length > 0) || (await this.landed(t, key, value, next));
    }
    if (!ok) throw new StoreConflictError(`${t.table} ${key} changed since it was read (expected version ${seen}); not written`);
    this.track(t, key, next);
  }

  private async readDocs(keys: string[]): Promise<Record<string, unknown>> {
    const { json } = await this.rest.req("GET", `record_docs?select=key,value&key=${inList(keys)}`);
    return Object.fromEntries((json as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  }

  private async writeDoc(key: string, value: unknown): Promise<void> {
    // Derived documents (recomputed from the records by the one runner holding the lock): a plain upsert.
    await this.rest.req("POST", "record_docs?on_conflict=key", { key, value, updated_at: new Date().toISOString() }, "resolution=merge-duplicates,return=minimal");
  }

  async get(matchId: string): Promise<SeriesRecord | null> {
    return (await this.readVersioned<SeriesRecord>(SERIES, matchId))[0] ?? null;
  }
  async put(record: SeriesRecord): Promise<void> {
    await this.writeVersioned(SERIES, record.series.matchId, record);
  }
  async all(): Promise<SeriesRecord[]> {
    return this.readVersioned<SeriesRecord>(SERIES);
  }
  async writeBoard(rows: BoardRow[]): Promise<void> {
    await this.writeDoc("board", rows);
  }
  async readBoard(): Promise<BoardRow[]> {
    return ((await this.readDocs(["board"])).board as BoardRow[] | undefined) ?? [];
  }
  async writeFanNames(names: Record<string, string | null>): Promise<void> {
    await this.writeDoc("fan_names", names);
  }
  async readFanNames(): Promise<Record<string, string | null>> {
    return ((await this.readDocs(["fan_names"])).fan_names as Record<string, string | null> | undefined) ?? {};
  }
  async getTitleDay(date: string): Promise<TitleDay | null> {
    return (await this.readVersioned<TitleDay>(DAYS, date))[0] ?? null;
  }
  async putTitleDay(day: TitleDay): Promise<void> {
    await this.writeVersioned(DAYS, day.date, day);
  }
  async titleDays(): Promise<TitleDay[]> {
    return this.readVersioned<TitleDay>(DAYS);
  }
  async writePending(rows: unknown[]): Promise<void> {
    await this.writeDoc("pending", rows);
  }
  async readScout(): Promise<ScoutData | null> {
    const { json } = await this.rest.req("GET", `scout_data?select=key,value&key=${inList(["series", "games", "teams"])}`);
    const byKey = Object.fromEntries((json as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
    return byKey.series && byKey.games && byKey.teams ? ({ series: byKey.series, games: byKey.games, teams: byKey.teams } as ScoutData) : null;
  }
  async readScoutFile(key: ScoutKey): Promise<unknown | null> {
    const { json } = await this.rest.req("GET", `scout_data?select=value&key=${eq(key)}`);
    return (json as { value: unknown }[])[0]?.value ?? null;
  }
  async writeScout(files: Partial<Record<ScoutKey, unknown>>): Promise<void> {
    const at = new Date().toISOString();
    const rows = Object.entries(files).filter(([k]) => (SCOUT_KEYS as readonly string[]).includes(k)).map(([key, value]) => ({ key, value, updated_at: at }));
    // One row per request: games.json alone is ~1.5 MB.
    for (const row of rows) await this.rest.req("POST", "scout_data?on_conflict=key", row, "resolution=merge-duplicates,return=minimal");
  }

  /** Everything the site and verify read, in three requests. */
  async snapshot(): Promise<RecordsSnapshot> {
    const [series, titleDays, docs] = await Promise.all([this.all(), this.titleDays(), this.readDocs(["board", "fan_names"])]);
    return { series, titleDays, board: (docs.board as BoardRow[] | undefined) ?? [], fanNames: (docs.fan_names as Record<string, string | null> | undefined) ?? {} };
  }
}

/** When a runner stage may run next, when it last ran, and what it reported. */
export type StageState = { nextAt: string | null; lastAt: string | null; note: string | null };

/** The runner's mutex (one stage at a time across Vercel and GitHub) and its per-stage schedule. */
export interface RunnerDb {
  /** Takes the lock for `ttlSeconds` (database clock), or renews it for the same holder. */
  acquireRunnerLock(holder: string, ttlSeconds: number): Promise<boolean>;
  releaseRunnerLock(holder: string): Promise<void>;
  readState(): Promise<Record<string, StageState>>;
  writeState(stage: string, state: StageState): Promise<void>;
}

export class SupabaseRunnerDb implements RunnerDb {
  constructor(private rest: SupabaseRest) {}

  async acquireRunnerLock(holder: string, ttlSeconds: number) {
    return (await this.rest.req("POST", "rpc/acquire_runner_lock", { p_holder: holder, p_ttl_seconds: ttlSeconds })).json === true;
  }
  async releaseRunnerLock(holder: string) {
    await this.rest.req("POST", "rpc/release_runner_lock", { p_holder: holder });
  }
  async readState() {
    const { json } = await this.rest.req("GET", "runner_state?select=stage,next_at,last_at,note");
    return Object.fromEntries((json as { stage: string; next_at: string | null; last_at: string | null; note: string | null }[]).map((r) => [r.stage, { nextAt: r.next_at, lastAt: r.last_at, note: r.note }]));
  }
  async writeState(stage: string, s: StageState) {
    await this.rest.req("POST", "runner_state?on_conflict=stage", { stage, next_at: s.nextAt, last_at: s.lastAt, note: s.note }, "resolution=merge-duplicates,return=minimal");
  }
}

/** "file" (default: data/ in git) or "supabase". Any other value is refused, so a typo never silently falls back to files. */
export function storeKind(env: Record<string, string | undefined> = process.env): "file" | "supabase" {
  const v = (env.KDACE_STORE ?? "").trim();
  if (v === "" || v === "file") return "file";
  if (v === "supabase") return "supabase";
  throw new Error(`KDACE_STORE must be "file" or "supabase", got "${v}"`);
}

/** The Supabase REST client from SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (throws when either is missing). */
export function supabaseRestFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): SupabaseRest {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("The Supabase record store needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return new SupabaseRest(url, key, fetchImpl);
}

/** The record store this process uses: the file Store in `dir` unless KDACE_STORE=supabase. */
export function storeFromEnv(env: Record<string, string | undefined> = process.env, dir = "data"): RecordStore {
  return storeKind(env) === "supabase" ? new SupabaseStore(supabaseRestFromEnv(env)) : new Store(dir);
}
