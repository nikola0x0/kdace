// The fan API's logic, framework-free: web/app/api/* routes only parse requests, call these and set cookies.
import type { FanDb } from "./fandb.ts";
import { googleAddress, zkLoginSalt, type GoogleIdentity } from "./google.ts";
import { crowdSplit, displayName, lockAt, pickReceipt, validateFanPick, type FanPickRow } from "./fans.ts";
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
const fail = (status: number, error: string): ApiResult => ({ status, body: { error } });

export async function issueNonce(deps: FanApiDeps, address: unknown): Promise<ApiResult> {
  if (!isAddress(address)) return fail(400, "address must be a 0x-prefixed 64-hex Sui address");
  const nonce = newNonce();
  const message = signInMessage({ address, nonce, issuedAt: deps.now().toISOString() });
  return { status: 200, body: { message, network: deps.network }, nonceToken: signToken({ nonce, address }, deps.sessionSecret, NONCE_TTL_MS, deps.now()) };
}

export async function signIn(deps: FanApiDeps, req: { bytes: unknown; signature: unknown; nonceToken: string | undefined }): Promise<ApiResult> {
  if (typeof req.bytes !== "string" || typeof req.signature !== "string") return fail(400, "bytes and signature are required");
  const bytes = new Uint8Array(Buffer.from(req.bytes, "base64"));
  const msg = parseSignInMessage(Buffer.from(bytes).toString("utf8"));
  if (!msg || !isAddress(msg.address)) return fail(400, "not a KDAce sign-in message");
  const now = deps.now();
  const expected = readToken<{ nonce: string; address: string }>(req.nonceToken, deps.sessionSecret, now);
  if (!expected || expected.nonce !== msg.nonce || expected.address !== msg.address) return fail(401, "sign-in expired or not started here; try again");
  const age = now.getTime() - Date.parse(msg.issuedAt);
  if (!(age >= -60_000 && age <= NONCE_TTL_MS)) return fail(401, "sign-in message is too old; try again");
  try {
    await deps.verifySignature(bytes, req.signature, msg.address);
  } catch {
    return fail(401, "signature does not match the address");
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
  if (!deps.verifyGoogleToken || !deps.zkLoginSaltSecret) return fail(503, "Google sign-in is not configured on this deployment");
  if (typeof req.idToken !== "string" || !req.idToken) return fail(400, "idToken is required");
  let id: GoogleIdentity;
  try {
    id = await deps.verifyGoogleToken(req.idToken);
  } catch {
    return fail(401, "Google sign-in could not be verified; try again");
  }
  const salt = zkLoginSalt(deps.zkLoginSaltSecret, id.iss, id.sub);
  let address: string;
  try {
    address = googleAddress(req.idToken, salt);
  } catch {
    return fail(400, "this Google account can't be mapped to a zkLogin address");
  }
  await deps.db.ensureFan(address, { method: "google", zkloginSalt: salt });
  return startSession(deps, address, deps.now());
}

export const sessionAddress = (deps: Pick<FanApiDeps, "sessionSecret" | "now">, token: string | undefined): string | null =>
  readToken<{ address: string }>(token, deps.sessionSecret, deps.now())?.address ?? null;

export async function postPick(deps: FanApiDeps, address: string | null, body: unknown): Promise<ApiResult> {
  if (!address) return fail(401, "sign in first");
  const { matchId, market, choice } = (body ?? {}) as Record<string, unknown>;
  if (typeof matchId !== "string" || typeof market !== "string" || typeof choice !== "string") return fail(400, "matchId, market and choice are required");
  const now = deps.now(); // server time decides the lock, never the client's
  const s = (await deps.fetchSeries()).find((x) => x.matchId === matchId);
  if (!s) return fail(404, "unknown series");
  if (s.state !== "unstarted" || isLocked(s.startTime, now)) return fail(409, `picks locked at ${lockAt(s.startTime)}`);
  const error = validateFanPick(s, market, choice, now);
  if (error) return fail(400, error);
  if ((await deps.db.listCommits()).some((c) => c.matchId === matchId)) return fail(409, "the fan batch for this series is already committed");
  const row: FanPickRow = { matchId, address, market: market as FanPickRow["market"], choice, updatedAt: now.toISOString() };
  await deps.db.ensureFan(address);
  await deps.db.upsertPick(row);
  return { status: 200, body: { receipt: pickReceipt(s, row) } };
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
        mine: Object.fromEntries(rows.filter((r) => r.matchId === s.matchId && r.address === address).map((r) => [r.market, r.choice])),
      })),
    },
  };
}

export async function getMe(deps: FanApiDeps, address: string | null): Promise<ApiResult> {
  if (!address) return fail(401, "not signed in");
  const suinsName = await refreshSuins(deps.db, address, deps.lookupName, deps.now());
  const picks = (await deps.db.picksOf(address)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { status: 200, body: { address, suinsName, displayName: displayName(address, suinsName), picks } };
}
