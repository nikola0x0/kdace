// Fan accounts, picks and fan-batch commits in Supabase, over its REST API (PostgREST).
// Server-side only: it uses the service role key, the only key allowed to write. Dependency-free (uses fetch).
import type { FanPickRow } from "./fans.ts";

/** A fan's result on one settled series. A win (net > 0) waits for the fan to claim it. */
export type FanResultRow = { matchId: string; address: string; stake: number; net: number; claimedAt: string | null };

/** One buy as it happened (positions in picks keep only the total). */
export type BuyRow = { id: number; matchId: string; address: string; market: string; choice: string; amount: number; at: string; canceledAt?: string | null };

export type FanAuthMethod = "google" | "wallet";
/** How a fan last signed in. Google fans also carry their zkLogin salt (the only way back to their address without ZKLOGIN_SALT_SECRET). */
export type FanAuth = { method: FanAuthMethod; zkloginSalt?: string; avatarUrl?: string };

/** A photo the fan uploaded (kept over their Google photo on later sign-ins). */
export const isCustomAvatar = (url: string | null | undefined) => !!url && url.includes("/storage/v1/object/public/avatars/");

export type FanRow = {
  address: string;
  suinsName: string | null;
  suinsCheckedAt: string | null;
  createdAt: string;
  authMethod?: FanAuthMethod | null;
  zkloginSalt?: string | null;
  /** Net AXP over settled series, written by the tick (0 until the fan's first series settles). */
  axpSettled?: number;
  /** Google profile photo (Google sign-in only). */
  avatarUrl?: string | null;
  /** The role the fan cheers for (top, jungle, mid, adc, support), or null. */
  favRole?: string | null;
  /** Up to two favourite champions (Data Dragon ids). */
  favChamps?: string[];
  /** A name the fan picked for themselves; shown before their SuiNS name or address. */
  nickname?: string | null;
};

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
  /** Set by the tick once this series' result is counted in the fans' axp_settled; until then its stakes stay open. */
  settledAt?: string | null;
};

export interface FanDb {
  getFan(address: string): Promise<FanRow | null>;
  /** Every fan with their cached SuiNS name and settled AXP, for the leaderboard. */
  listFans(): Promise<{ address: string; suinsName: string | null; axpSettled: number; avatarUrl: string | null; favRole: string | null; favChamps: string[]; nickname: string | null }[]>;
  /** Sets (or with null clears) the fan's chosen name (already validated). */
  setNickname(address: string, nickname: string | null): Promise<void>;
  /** Stores a profile photo the fan uploaded and points their avatar at it (null clears the avatar). Returns the URL. */
  setCustomAvatar(address: string, image: { bytes: Uint8Array; type: string } | null): Promise<string | null>;
  /** Sets the fan's favourite champions (up to two ids, already validated). */
  setFavChamps(address: string, champs: string[]): Promise<void>;
  /** Sets (or with null clears) the fan's favourite role. */
  setFavRole(address: string, role: string | null): Promise<void>;
  /** Creates the fan row if it doesn't exist yet. With `auth`, also records how they signed in (a salt, once set, is kept). */
  ensureFan(address: string, auth?: FanAuth): Promise<void>;
  setSuins(address: string, name: string | null, checkedAt: string): Promise<void>;
  /** Names to show (address → chosen name, else cached SuiNS name, else null) for the given fans. */
  fanNames(addresses: string[]): Promise<Record<string, string | null>>;
  upsertPick(row: FanPickRow): Promise<void>;
  /** Adds `row.stake` to the fan's position on that outcome (creating it at that stake); returns the position. */
  buyPick(row: FanPickRow): Promise<FanPickRow>;
  /** Writes each fan's result per settled series; never touches claimed_at. */
  upsertResults(rows: Omit<FanResultRow, "claimedAt">[]): Promise<void>;
  /** All results for one fan, or every unclaimed win when `address` is omitted. */
  results(address?: string): Promise<FanResultRow[]>;
  /** Marks an unclaimed win as claimed (once); returns it, or null if there was nothing to claim. */
  claimResult(matchId: string, address: string, at: string): Promise<FanResultRow | null>;
  /** Cancels one of the fan's buys before lock (its AXP leaves the position); returns the amount. Throws "locked" / "no_such_buy". */
  cancelBuy(buyId: number, address: string, at: string): Promise<number>;
  /** Every buy one fan made, newest first. */
  buysOf(address: string): Promise<BuyRow[]>;
  /** Most recent buys from the append-only log (newest first), optionally for one match. */
  recentBuys(limit: number, matchId?: string): Promise<BuyRow[]>;
  picksFor(matchIds: string[]): Promise<FanPickRow[]>;
  picksOf(address: string): Promise<FanPickRow[]>;
  listCommits(): Promise<FanCommitRow[]>;
  /** False when a row for this match already exists (another run claimed it). */
  insertCommit(row: FanCommitRow): Promise<boolean>;
  /** With `ifAttemptedAt`, only updates if the row still has that attempt stamp. True when a row changed. */
  updateCommit(matchId: string, patch: Partial<FanCommitRow>, ifAttemptedAt?: string): Promise<boolean>;
  /** Writes each fan's net AXP over settled series (address → net). Touches no other column. */
  setAxpSettled(nets: Record<string, number>): Promise<void>;
  /** Stamps settled_at on these fan commits, unless already stamped. */
  markCommitsSettled(matchIds: string[], at: string): Promise<void>;
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

  async upsertResults(rows: Omit<FanResultRow, "claimedAt">[]) {
    if (!rows.length) return;
    await this.req("POST", "fan_results?on_conflict=match_id,address", rows.map((r) => toRow(r)), "resolution=merge-duplicates,return=minimal");
  }
  async results(address?: string) {
    const { json } = await this.req("GET", address ? `fan_results?select=*&address=${eq(address)}` : "fan_results?select=*&claimed_at=is.null&net=gt.0");
    return (json as Record<string, unknown>[]).map((r) => fromRow<FanResultRow>(r));
  }
  async claimResult(matchId: string, address: string, at: string) {
    const { json } = await this.req("PATCH", `fan_results?match_id=${eq(matchId)}&address=${eq(address)}&claimed_at=is.null&net=gt.0`, { claimed_at: at }, "return=representation");
    return json?.[0] ? fromRow<FanResultRow>(json[0]) : null;
  }
  async cancelBuy(buyId: number, address: string, at: string) {
    const { json } = await this.req("POST", "rpc/cancel_buy", { p_buy_id: buyId, p_address: address, p_at: at });
    return Number(json);
  }
  async buysOf(address: string) {
    const { json } = await this.req("GET", `buys?select=*&address=${eq(address)}&canceled_at=is.null&order=at.desc,id.desc`);
    return (json as Record<string, unknown>[]).map((r) => fromRow<BuyRow>(r));
  }
  async recentBuys(limit: number, matchId?: string) {
    const { json } = await this.req("GET", `buys?select=*&canceled_at=is.null&order=at.desc,id.desc&limit=${limit}${matchId ? `&match_id=${eq(matchId)}` : ""}`);
    return (json as Record<string, unknown>[]).map((r) => fromRow<BuyRow>(r));
  }
  async listFans() {
    const { json } = await this.req("GET", "fans?select=address,suins_name,axp_settled,avatar_url,fav_role,fav_champs,nickname");
    return (json as { address: string; suins_name: string | null; axp_settled: number; avatar_url: string | null; fav_role: string | null; fav_champs: string[] | null; nickname: string | null }[]).map((r) => ({ address: r.address, suinsName: r.suins_name, axpSettled: r.axp_settled ?? 0, avatarUrl: r.avatar_url ?? null, favRole: r.fav_role ?? null, favChamps: r.fav_champs ?? [], nickname: r.nickname ?? null }));
  }
  async setCustomAvatar(address: string, image: { bytes: Uint8Array; type: string } | null) {
    let url: string | null = null;
    if (image) {
      const base = this.url.replace(/\/$/, "");
      const path = `avatars/${address}`;
      const headers: Record<string, string> = { apikey: this.key, "Content-Type": image.type, "x-upsert": "true", "Cache-Control": "max-age=60" };
      if (this.key.startsWith("eyJ")) headers.Authorization = `Bearer ${this.key}`;
      const res = await this.fetchImpl(`${base}/storage/v1/object/${path}`, { method: "POST", headers, body: image.bytes as BodyInit });
      if (!res.ok) throw new Error(`Supabase storage upload HTTP ${res.status}: ${await res.text()}`);
      // Same path on every upload; the version query makes browsers fetch the new photo.
      url = `${base}/storage/v1/object/public/${path}?v=${Date.now()}`;
    }
    await this.req("PATCH", `fans?address=${eq(address)}`, { avatar_url: url }, "return=minimal");
    return url;
  }
  async setNickname(address: string, nickname: string | null) {
    await this.req("PATCH", `fans?address=${eq(address)}`, { nickname }, "return=minimal");
  }
  async setFavChamps(address: string, champs: string[]) {
    await this.req("PATCH", `fans?address=${eq(address)}`, { fav_champs: champs }, "return=minimal");
  }
  async setFavRole(address: string, role: string | null) {
    await this.req("PATCH", `fans?address=${eq(address)}`, { fav_role: role }, "return=minimal");
  }
  async getFan(address: string) {
    const { json } = await this.req("GET", `fans?select=*&address=${eq(address)}`);
    return json?.[0] ? fromRow<FanRow>(json[0]) : null;
  }
  async ensureFan(address: string, auth?: FanAuth) {
    if (!auth) return void (await this.req("POST", "fans?on_conflict=address", { address }, "resolution=ignore-duplicates,return=minimal"));
    const row: Record<string, string> = { address, auth_method: auth.method };
    if (auth.zkloginSalt !== undefined) row.zklogin_salt = auth.zkloginSalt;
    if (auth.avatarUrl !== undefined && !isCustomAvatar((await this.getFan(address))?.avatarUrl)) row.avatar_url = auth.avatarUrl;
    await this.req("POST", "fans?on_conflict=address", row, "resolution=merge-duplicates,return=minimal");
  }
  async setSuins(address: string, name: string | null, checkedAt: string) {
    await this.req("PATCH", `fans?address=${eq(address)}`, { suins_name: name, suins_checked_at: checkedAt }, "return=minimal");
  }
  async fanNames(addresses: string[]) {
    if (!addresses.length) return {};
    const { json } = await this.req("GET", `fans?select=address,suins_name,nickname&address=${inList(addresses)}`);
    return Object.fromEntries((json as { address: string; suins_name: string | null; nickname: string | null }[]).map((r) => [r.address, r.nickname || r.suins_name]));
  }
  async upsertPick(row: FanPickRow) {
    await this.req("POST", "picks?on_conflict=match_id,address,market,choice", toRow(row), "resolution=merge-duplicates,return=minimal");
  }
  async buyPick(row: FanPickRow) {
    // One atomic statement in Postgres (insert, or add to the existing stake), so concurrent buys never lose AXP.
    // Postgres also refuses a buy on the other side of a market the fan already holds (raises "other_side").
    const { json } = await this.req("POST", "rpc/buy_pick", { p_match_id: row.matchId, p_address: row.address, p_market: row.market, p_choice: row.choice, p_amount: row.stake, p_at: row.updatedAt });
    return { ...row, stake: Number(json) };
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
  async setAxpSettled(nets: Record<string, number>) {
    const rows = Object.entries(nets).map(([address, net]) => ({ address, axp_settled: net }));
    if (!rows.length) return;
    // merge-duplicates updates only the columns sent, so names, salts and sign-in methods are untouched.
    await this.req("POST", "fans?on_conflict=address", rows, "resolution=merge-duplicates,return=minimal");
  }
  async markCommitsSettled(matchIds: string[], at: string) {
    if (!matchIds.length) return;
    await this.req("PATCH", `fan_commits?match_id=${inList(matchIds)}&settled_at=is.null`, { settled_at: at }, "return=minimal");
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
