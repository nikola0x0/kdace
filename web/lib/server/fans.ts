// Server-side wiring for the fan API routes: Supabase, Tatum (signature checks and SuiNS), Google sign-in and the
// session cookie.
// The logic itself lives in src/core/fanapi.ts and is unit-tested there.
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import type { Network } from "../../../src/core/chain.ts";
import { type ApiResult, type FanApiDeps, sessionAddress, SESSION_TTL_MS, NONCE_TTL_MS } from "../../../src/core/fanapi.ts";
import { fanDbFromEnv } from "../../../src/core/fandb.ts";
import { verifyGoogleIdToken } from "../../../src/core/google.ts";
import { tatumClient } from "../../../src/core/sui.ts";
import { fetchSeries, type Series } from "../../../src/core/worlds.ts";

export const SESSION_COOKIE = "kdace_session";
export const NONCE_COOKIE = "kdace_nonce";

/** The network fans sign in against: the ledger's network. */
export const signInNetwork = (): Network => (process.env.SUI_NETWORK === "mainnet" ? "mainnet" : "testnet");

// The schedule changes rarely; a short cache keeps each pick from hitting lolesports. Lock is still judged on server time.
let cached: { at: number; series: Series[] } | null = null;
export async function cachedSeries(): Promise<Series[]> {
  if (cached && Date.now() - cached.at < 30_000) return cached.series;
  cached = { at: Date.now(), series: await fetchSeries() };
  return cached.series;
}

/** Real dependencies, or null when Supabase or the session secret isn't configured yet. */
export function fanDeps(): FanApiDeps | null {
  const db = fanDbFromEnv();
  const sessionSecret = process.env.SESSION_SECRET;
  if (!db || !sessionSecret) return null;
  const network = signInNetwork();
  return {
    db,
    fetchSeries: cachedSeries,
    now: () => new Date(),
    sessionSecret,
    network,
    // zkLogin signatures are checked against the network's current JWKs, hence the client.
    verifySignature: async (bytes, signature, address) => {
      await verifyPersonalMessageSignature(bytes, signature, { client: tatumClient(network), address });
    },
    // SuiNS lives on mainnet whatever network the ledger is on.
    lookupName: async (address) => (await tatumClient("mainnet").defaultNameServiceName({ address })).data.name,
    // Google sign-in is on when both are set; Google's signing keys are fetched once and cached.
    ...googleSignInDeps(),
  };
}

function googleSignInDeps(): Pick<FanApiDeps, "verifyGoogleToken" | "zkLoginSaltSecret"> {
  const clientId = process.env.GOOGLE_CLIENT_ID, zkLoginSaltSecret = process.env.ZKLOGIN_SALT_SECRET;
  if (!clientId || !zkLoginSaltSecret) return {};
  return { verifyGoogleToken: (idToken) => verifyGoogleIdToken(idToken, { clientId }), zkLoginSaltSecret };
}

export const notConfigured = () => NextResponse.json({ error: "Fan picks are not configured on this deployment yet." }, { status: 503 });

export const currentFan = (deps: FanApiDeps, req: NextRequest) => sessionAddress(deps, req.cookies.get(SESSION_COOKIE)?.value);

const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

export function respond(r: ApiResult): NextResponse {
  const res = NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  if (r.nonceToken) res.cookies.set(NONCE_COOKIE, r.nonceToken, { ...cookieBase, maxAge: NONCE_TTL_MS / 1000 });
  if (r.session) {
    res.cookies.set(SESSION_COOKIE, r.session, { ...cookieBase, maxAge: SESSION_TTL_MS / 1000 });
    res.cookies.delete(NONCE_COOKIE);
  }
  return res;
}

/** Constant-time check of `Authorization: Bearer <LOCK_SECRET>`. */
export function lockAuthorized(req: NextRequest): boolean {
  const secret = process.env.LOCK_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || secret.length < 16) return false;
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Turns an unexpected failure (database or chain unreachable) into a JSON 502 instead of an empty 500. */
export function guarded<A extends unknown[]>(handler: (...args: A) => Promise<NextResponse>) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (e) {
      console.error("[fans api]", e);
      return NextResponse.json({ error: "Upstream service unavailable, try again shortly." }, { status: 502 });
    }
  };
}

export const readJson =async (req: NextRequest): Promise<unknown> => req.json().catch(() => null);
