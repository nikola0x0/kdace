// Fan accounts, picks and fan-batch commits in Supabase, over its REST API (PostgREST).
// Server-side only: it uses the service role key, the only key allowed to write. Dependency-free (uses fetch).
import type { FanPickRow } from "./fans.ts";

export type FanRow = { address: string; suinsName: string | null; suinsCheckedAt: string | null; createdAt: string };

/** One fan batch per series. Written before the chain call (`committing`) and after it (`committed`), like src/jobs/pick.ts. */
export type FanCommitRow = {
  matchId: string;
  status: "committing" | "committed" | "missed";
  batch: string | null;
  batchHash: string | null;
  pickCount: number;
  commitDigest: string | null;
  network: string;
  packageId: string;
  committedAt: string | null;
  attemptedAt: string;
};

export interface FanDb {
  getFan(address: string): Promise<FanRow | null>;
  /** Creates the fan row if it doesn't exist yet. */
  ensureFan(address: string): Promise<void>;
  setSuins(address: string, name: string | null, checkedAt: string): Promise<void>;
  /** Cached SuiNS names (address → name or null) for the given fans. */
  fanNames(addresses: string[]): Promise<Record<string, string | null>>;
  upsertPick(row: FanPickRow): Promise<void>;
  picksFor(matchIds: string[]): Promise<FanPickRow[]>;
  picksOf(address: string): Promise<FanPickRow[]>;
  listCommits(): Promise<FanCommitRow[]>;
  /** False when a row for this match already exists (another run claimed it). */
  insertCommit(row: FanCommitRow): Promise<boolean>;
  /** With `ifAttemptedAt`, only updates if the row still has that attempt stamp. True when a row changed. */
  updateCommit(matchId: string, patch: Partial<FanCommitRow>, ifAttemptedAt?: string): Promise<boolean>;
  /** Mutex for Referee transactions shared by the tick and the lock route (database clock decides expiry). */
  acquireRefereeLock(holder: string, ttlSeconds: number): Promise<boolean>;
  releaseRefereeLock(holder: string): Promise<void>;
  /** A cheap read; keeps a free Supabase project from pausing. */
  ping(): Promise<void>;
}

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (key: string) => key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
const mapKeys = (o: Record<string, unknown>, f: (k: string) => string) => Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]));
const fromRow = <T>(o: Record<string, unknown>) => mapKeys(o, camel) as T;
const toRow = (o: object) => mapKeys(o as Record<string, unknown>, snake);
const eq = (v: string) => `eq.${encodeURIComponent(v)}`;
const inList = (vs: string[]) => `in.(${vs.map((v) => encodeURIComponent(`"${v}"`)).join(",")})`;

export class SupabaseFanDb implements FanDb {
  constructor(private url: string, private key: string, private fetchImpl: typeof fetch = fetch) {}

  private async req(method: string, path: string, body?: unknown, prefer?: string): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { apikey: this.key, "Content-Type": "application/json" };
    // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys must not.
    if (this.key.startsWith("eyJ")) headers.Authorization = `Bearer ${this.key}`;
    if (prefer) headers.Prefer = prefer;
    const res = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (res.status === 409) return { status: 409, json };
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]} HTTP ${res.status}: ${json?.message ?? text}`);
    return { status: res.status, json };
  }

  async getFan(address: string) {
    const { json } = await this.req("GET", `fans?select=*&address=${eq(address)}`);
    return json?.[0] ? fromRow<FanRow>(json[0]) : null;
  }
  async ensureFan(address: string) {
    await this.req("POST", "fans?on_conflict=address", { address }, "resolution=ignore-duplicates,return=minimal");
  }
  async setSuins(address: string, name: string | null, checkedAt: string) {
    await this.req("PATCH", `fans?address=${eq(address)}`, { suins_name: name, suins_checked_at: checkedAt }, "return=minimal");
  }
  async fanNames(addresses: string[]) {
    if (!addresses.length) return {};
    const { json } = await this.req("GET", `fans?select=address,suins_name&address=${inList(addresses)}`);
    return Object.fromEntries((json as { address: string; suins_name: string | null }[]).map((r) => [r.address, r.suins_name]));
  }
  async upsertPick(row: FanPickRow) {
    await this.req("POST", "picks?on_conflict=match_id,address,market", toRow(row), "resolution=merge-duplicates,return=minimal");
  }
  async picksFor(matchIds: string[]) {
    if (!matchIds.length) return [];
    const { json } = await this.req("GET", `picks?select=*&match_id=${inList(matchIds)}`);
    return (json as Record<string, unknown>[]).map((r) => fromRow<FanPickRow>(r));
  }
  async picksOf(address: string) {
    const { json } = await this.req("GET", `picks?select=*&address=${eq(address)}`);
    return (json as Record<string, unknown>[]).map((r) => fromRow<FanPickRow>(r));
  }
  async listCommits() {
    const { json } = await this.req("GET", "fan_commits?select=*");
    return (json as Record<string, unknown>[]).map((r) => fromRow<FanCommitRow>(r));
  }
  async insertCommit(row: FanCommitRow) {
    return (await this.req("POST", "fan_commits", toRow(row), "return=minimal")).status !== 409;
  }
  async updateCommit(matchId: string, patch: Partial<FanCommitRow>, ifAttemptedAt?: string) {
    const guard = ifAttemptedAt ? `&attempted_at=${eq(ifAttemptedAt)}` : "";
    const { json } = await this.req("PATCH", `fan_commits?match_id=${eq(matchId)}${guard}`, toRow(patch), "return=representation");
    return Array.isArray(json) && json.length > 0;
  }
  async acquireRefereeLock(holder: string, ttlSeconds: number) {
    return (await this.req("POST", "rpc/acquire_referee_lock", { p_holder: holder, p_ttl_seconds: ttlSeconds })).json === true;
  }
  async releaseRefereeLock(holder: string) {
    await this.req("POST", "rpc/release_referee_lock", { p_holder: holder });
  }
  async ping() {
    await this.req("GET", "fan_commits?select=match_id&limit=1");
  }
}

/** The configured database, or null when Supabase isn't set up (fan features off, the tick runs as before). */
export function fanDbFromEnv(env: Record<string, string | undefined> = process.env): FanDb | null {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? new SupabaseFanDb(url, key) : null;
}

const realSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs one Referee transaction while holding the shared mutex. The tick and the lock route sign with the same key and
 * the same ResolverCap; two concurrent transactions on one owned object can lock it until the epoch ends.
 */
export async function withRefereeLock<T>(
  db: FanDb | null,
  holder: string,
  fn: () => Promise<T>,
  opts: { waitMs?: number; ttlSeconds?: number; sleep?: (ms: number) => Promise<void>; proceedIfDbDown?: boolean } = {},
): Promise<T> {
  if (!db) return fn();
  const { waitMs = 60_000, ttlSeconds = 120, sleep = realSleep, proceedIfDbDown = false } = opts;
  const acquire = async () => {
    try {
      return await db.acquireRefereeLock(holder, ttlSeconds);
    } catch (e) {
      // The lock route needs the database too, so with it down nobody else can be signing.
      if (proceedIfDbDown) return null;
      throw e;
    }
  };
  const started = Date.now();
  let got: boolean | null;
  while (!(got = await acquire())) {
    if (got === null) return fn();
    if (Date.now() - started >= waitMs) throw new Error(`Referee busy: could not take the referee lock within ${waitMs / 1000}s`);
    await sleep(2000);
  }
  try {
    return await fn();
  } finally {
    await db.releaseRefereeLock(holder).catch(() => {});
  }
}
