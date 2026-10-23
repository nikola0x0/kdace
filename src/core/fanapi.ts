// The fan API's logic, framework-free: web/app/api/* routes only parse requests, call these and set cookies.
import type { FanCommitRow, FanDb } from "./fandb.ts";
import { googleAddress, zkLoginSalt, type GoogleIdentity } from "./google.ts";
import { crowdSplit, displayName, lockAt, pickReceipt, validateFanPick, type FanPickRow } from "./fans.ts";
import { AXP_START } from "./points.ts";
import { isLocked } from "./select.ts";
import { newNonce, parseSignInMessage, readToken, signInMessage, signToken } from "./session.ts";
import { refreshSuins } from "./suins.ts";
import type { Series } from "./worlds.ts";

export type FanApiDeps = {
  db: FanDb;
  fetchSeries(): Promise<Series[]>;
  now(): Date;
  sessionSecret: string;
  /** The Sui network fans sign in against (zkLogin signatures are network-bound). */
  network: string;
  /** Throws unless `signature` is `address`'s valid personal-message signature over `bytes` (zkLogin included). */
  verifySignature(bytes: Uint8Array, signature: string, address: string): Promise<void>;
  /** Default SuiNS name on mainnet, or null. */
  lookupName(address: string): Promise<string | null>;
  /** Google sign-in (both unset = off): throws unless `idToken` is a valid Google ID token for our client ID. */
  verifyGoogleToken?(idToken: string): Promise<GoogleIdentity>;
  /** Derives every Google fan's zkLogin salt. Must be backed up: losing it loses the way back to their addresses. */
  zkLoginSaltSecret?: string;
};

export type ApiResult = { status: number; body: unknown; session?: string; nonceToken?: string };

export const SESSION_TTL_MS = 7 * 24 * 3600_000;
export const NONCE_TTL_MS = 5 * 60_000;
const isAddress = (a: unknown): a is string => typeof a === "string" && /^0x[0-9a-f]{64}$/.test(a);
// Error texts are shown to fans as-is: plain words, no crypto jargon.
const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });

export async function issueNonce(deps: FanApiDeps, address: unknown): Promise<ApiResult> {
  if (!isAddress(address)) return fail(400, "This wallet can't be used here. Try another one.");
  const nonce = newNonce();
  const message = signInMessage({ address, nonce, issuedAt: deps.now().toISOString() });
  return { status: 200, body: { message, network: deps.network }, nonceToken: signToken({ nonce, address }, deps.sessionSecret, NONCE_TTL_MS, deps.now()) };
}

export async function signIn(deps: FanApiDeps, req: { bytes: unknown; signature: unknown; nonceToken: string | undefined }): Promise<ApiResult> {
  if (typeof req.bytes !== "string" || typeof req.signature !== "string") return fail(400, "Sign-in didn't work. Please try again.");
  const bytes = new Uint8Array(Buffer.from(req.bytes, "base64"));
  const msg = parseSignInMessage(Buffer.from(bytes).toString("utf8"));
  if (!msg || !isAddress(msg.address)) return fail(400, "Sign-in didn't work. Please try again.");
  const now = deps.now();
  const expected = readToken<{ nonce: string; address: string }>(req.nonceToken, deps.sessionSecret, now);
  if (!expected || expected.nonce !== msg.nonce || expected.address !== msg.address) return fail(401, "Sign-in took too long. Please try again.");
  const age = now.getTime() - Date.parse(msg.issuedAt);
  if (!(age >= -60_000 && age <= NONCE_TTL_MS)) return fail(401, "Sign-in took too long. Please try again.");
  try {
    await deps.verifySignature(bytes, req.signature, msg.address);
  } catch {
    return fail(401, "Your wallet didn't confirm the sign-in. Please try again.");
  }
  await deps.db.ensureFan(msg.address, { method: "wallet" });
  return startSession(deps, msg.address, now);
}

async function startSession(deps: FanApiDeps, address: string, now: Date): Promise<ApiResult> {
  const suinsName = await refreshSuins(deps.db, address, deps.lookupName, now, true);
  return {
    status: 200,
    body: { address, suinsName, displayName: displayName(address, suinsName) },
    session: signToken({ address }, deps.sessionSecret, SESSION_TTL_MS, now),
  };
}

/**
 * Sign in with Google: the verified ID token is the proof. The fan's address is their zkLogin address for our salt,
 * the same one any zkLogin prover would reach with that salt, on testnet and mainnet alike.
 */
export async function googleSignIn(deps: FanApiDeps, req: { idToken: unknown }): Promise<ApiResult> {
  if (!deps.verifyGoogleToken || !deps.zkLoginSaltSecret) return fail(503, "Sign in with Google isn't available yet. Use a crypto wallet instead.");
  if (typeof req.idToken !== "string" || !req.idToken) return fail(400, "Google sign-in didn't work. Please try again.");
  let id: GoogleIdentity;
  try {
    id = await deps.verifyGoogleToken(req.idToken);
  } catch {
    return fail(401, "Google sign-in didn't work. Please try again.");
  }
  const salt = zkLoginSalt(deps.zkLoginSaltSecret, id.iss, id.sub);
  let address: string;
  try {
    address = googleAddress(req.idToken, salt);
  } catch {
    return fail(400, "This Google account can't be used here. Use a crypto wallet instead.");
  }
  await deps.db.ensureFan(address, { method: "google", zkloginSalt: salt, ...(id.picture ? { avatarUrl: id.picture } : {}) });
  return startSession(deps, address, deps.now());
}

export const sessionAddress = (deps: Pick<FanApiDeps, "sessionSecret" | "now">, token: string | undefined): string | null =>
  readToken<{ address: string }>(token, deps.sessionSecret, deps.now())?.address ?? null;

/** A fan's AXP: start, net over settled series, stakes still open, and what's free to stake. */
export type FanAxp = { start: number; settled: number; open: number; available: number };

/**
 * A pick's stake is open until its series is counted into axp_settled. It is freed once that happens (the fan
 * commit is stamped settled), when the fan batch missed the chain, or when the series ended without a fan batch.
 */
function isOpenPick(p: FanPickRow, commits: Map<string, FanCommitRow>, series: Map<string, Series>): boolean {
  const c = commits.get(p.matchId);
  if (c) return c.status !== "missed" && !c.settledAt;
  const s = series.get(p.matchId);
  return !!s && s.state !== "completed";
}

/** `except` leaves one market out of the open stakes: the pick being replaced doesn't count against itself. */
async function fanAxp(deps: FanApiDeps, address: string, ctx: { picks: FanPickRow[]; commits: FanCommitRow[]; series: Series[] }): Promise<FanAxp> {
  const settled = (await deps.db.getFan(address))?.axpSettled ?? 0;
  const commits = new Map(ctx.commits.map((c) => [c.matchId, c]));
  const series = new Map(ctx.series.map((s) => [s.matchId, s]));
  const open = ctx.picks
    .filter((p) => isOpenPick(p, commits, series))
    .reduce((sum, p) => sum + p.stake, 0);
  return { start: AXP_START, settled, open, available: AXP_START + settled - open };
}

const axpText = (n: number) => Math.max(0, n).toLocaleString("en-US");

export async function postPick(deps: FanApiDeps, address: string | null, body: unknown): Promise<ApiResult> {
  if (!address) return fail(401, "Sign in first to make a pick.");
  const { matchId, market, choice, stake } = (body ?? {}) as Record<string, unknown>;
  if (typeof matchId !== "string" || typeof market !== "string" || typeof choice !== "string") return fail(400, "That pick couldn't be saved. Please try again.");
  const now = deps.now(); // server time decides the lock, never the client's
  const all = await deps.fetchSeries();
  const s = all.find((x) => x.matchId === matchId);
  if (!s) return fail(404, "That match isn't open for picks.");
  if (s.state !== "unstarted" || isLocked(s.startTime, now)) return fail(409, `picks locked at ${lockAt(s.startTime)}`);
  const error = validateFanPick(s, market, choice, stake, now);
  if (error) return fail(400, error);
  const commits = await deps.db.listCommits();
  if (commits.some((c) => c.matchId === matchId)) return fail(409, "Picks for this match are closed.");
  await deps.db.ensureFan(address);
  const { available } = await fanAxp(deps, address, { picks: await deps.db.picksOf(address), commits, series: all });
  if ((stake as number) > available) return fail(400, `You only have ${axpText(available)} AXP available.`);
  // A buy adds to the fan's position on this outcome, like buying more shares on Outcomes.
  const position = await deps.db.buyPick({ matchId, address, market: market as FanPickRow["market"], choice, stake: stake as number, updatedAt: now.toISOString() });
  return { status: 200, body: { receipt: pickReceipt(s, position) } };
}

export async function listPicks(deps: FanApiDeps, address: string | null): Promise<ApiResult> {
  const now = deps.now();
  const open = (await deps.fetchSeries())
    .filter((s) => s.state === "unstarted" && s.teamA !== "TBD" && s.teamB !== "TBD" && !isLocked(s.startTime, now))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const rows = await deps.db.picksFor(open.map((s) => s.matchId));
  return {
    status: 200,
    body: {
      serverTime: now.toISOString(),
      series: open.map((s) => ({
        series: s,
        lockAt: lockAt(s.startTime),
        crowd: crowdSplit(s, rows),
        // The fan's positions: market -> outcome -> total AXP bought.
        mine: rows.filter((r) => r.matchId === s.matchId && r.address === address).reduce<Record<string, Record<string, number>>>((m, r) => ((m[r.market] ??= {})[r.choice] = r.stake, m), {}),
      })),
    },
  };
}

/** Every signed-in fan for the leaderboard: total (10,000 AXP plus settled results), AXP in open positions, and balance (total − in play, free to bet). */
export async function leaderboardFans(deps: FanApiDeps): Promise<ApiResult> {
  const [fans, commitRows, seriesRows] = await Promise.all([deps.db.listFans(), deps.db.listCommits(), deps.fetchSeries()]);
  const commits = new Map(commitRows.map((c) => [c.matchId, c]));
  const series = new Map(seriesRows.map((s) => [s.matchId, s]));
  const openIds = [...new Set([...seriesRows.filter((s) => s.state !== "completed").map((s) => s.matchId), ...commitRows.filter((c) => c.status !== "missed" && !c.settledAt).map((c) => c.matchId)])];
  const inPlay: Record<string, number> = {};
  for (const p of await deps.db.picksFor(openIds)) if (isOpenPick(p, commits, series)) inPlay[p.address] = (inPlay[p.address] ?? 0) + p.stake;
  return {
    status: 200,
    body: { fans: fans.map((f) => ({ address: f.address, displayName: displayName(f.address, f.suinsName), avatarUrl: f.avatarUrl, favRole: f.favRole, favChamps: f.favChamps, total: AXP_START + f.axpSettled, balance: AXP_START + f.axpSettled - (inPlay[f.address] ?? 0), net: f.axpSettled, inPlay: inPlay[f.address] ?? 0 })) },
  };
}

/** The live feed: recent buys with each buyer's display name and avatar (all public: picks are published anyway). */
export async function activity(deps: FanApiDeps, opts: { matchId?: string; limit?: number }): Promise<ApiResult> {
  const buys = await deps.db.recentBuys(Math.min(opts.limit ?? 20, 50), opts.matchId);
  const fans = new Map((await deps.db.listFans()).map((f) => [f.address, f]));
  return {
    status: 200,
    body: {
      buys: buys.map((b) => ({ id: b.id, matchId: b.matchId, market: b.market, choice: b.choice, amount: b.amount, at: b.at, address: b.address, name: displayName(b.address, fans.get(b.address)?.suinsName), avatarUrl: fans.get(b.address)?.avatarUrl ?? null, favRole: fans.get(b.address)?.favRole ?? null, favChamps: fans.get(b.address)?.favChamps ?? [] })),
    },
  };
}

export async function getMe(deps: FanApiDeps, address: string | null): Promise<ApiResult> {
  if (!address) return fail(401, "Not signed in.");
  const suinsName = await refreshSuins(deps.db, address, deps.lookupName, deps.now());
  const rows = (await deps.db.picksOf(address)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const axp = await fanAxp(deps, address, { picks: rows, commits: await deps.db.listCommits(), series: await deps.fetchSeries() });
  const picks = rows.map(({ matchId, market, choice, stake, updatedAt }) => ({ matchId, market, choice, stake, updatedAt }));
  const fan = await deps.db.getFan(address);
  return { status: 200, body: { address, suinsName, displayName: displayName(address, suinsName), avatarUrl: fan?.avatarUrl ?? null, favRole: fan?.favRole ?? null, favChamps: fan?.favChamps ?? [], picks, axp } };
}

const AVATAR_MAX_BYTES = 200 * 1024;
const AVATAR_TYPES: Record<string, (b: Uint8Array) => boolean> = {
  "image/webp": (b) => String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP",
  "image/png": (b) => b[0] === 0x89 && String.fromCharCode(...b.subarray(1, 4)) === "PNG",
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

/** Sets the fan's profile photo from a data URL (WebP, PNG or JPEG, checked by its bytes, up to 200 KB), or clears it with null. */
export async function setAvatar(deps: FanApiDeps, address: string | null, body: unknown): Promise<ApiResult> {
  if (!address) return fail(401, "Not signed in.");
  const image = (body as { image?: unknown } | null)?.image;
  if (image === null) return { status: 200, body: { avatarUrl: await deps.db.setCustomAvatar(address, null) } };
  const m = typeof image === "string" ? /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(image) : null;
  if (!m || !AVATAR_TYPES[m[1]]) return fail(400, "Use a JPG, PNG or WebP image.");
  const bytes = new Uint8Array(Buffer.from(m[2], "base64"));
  if (bytes.length > AVATAR_MAX_BYTES) return fail(400, "That image is too big (200 KB max).");
  if (!AVATAR_TYPES[m[1]](bytes)) return fail(400, "Use a JPG, PNG or WebP image.");
  return { status: 200, body: { avatarUrl: await deps.db.setCustomAvatar(address, { bytes, type: m[1] }) } };
}

/** Sets up to two favourite champions by Data Dragon id (letters only, like "JarvanIV"); duplicates collapse. */
export async function setFavChamps(deps: FanApiDeps, address: string | null, body: unknown): Promise<ApiResult> {
  if (!address) return fail(401, "Not signed in.");
  const raw = (body as { favChamps?: unknown } | null)?.favChamps;
  if (!Array.isArray(raw) || raw.length > 2 || !raw.every((c) => typeof c === "string" && /^[A-Za-z]{2,24}$/.test(c))) return fail(400, "Pick up to two champions.");
  const champs = [...new Set(raw as string[])];
  await deps.db.setFavChamps(address, champs);
  return { status: 200, body: { favChamps: champs } };
}

export const FAV_ROLES = ["top", "jungle", "mid", "adc", "support"] as const;

/** Sets the role a fan cheers for (one of the five analyst roles), or clears it with null. */
export async function setFavRole(deps: FanApiDeps, address: string | null, body: unknown): Promise<ApiResult> {
  if (!address) return fail(401, "Not signed in.");
  const role = (body as { favRole?: unknown } | null)?.favRole;
  if (role !== null && !FAV_ROLES.includes(role as (typeof FAV_ROLES)[number])) return fail(400, "Pick one of: top, jungle, mid, adc, support.");
  await deps.db.setFavRole(address, role as string | null);
  return { status: 200, body: { favRole: role } };
}
