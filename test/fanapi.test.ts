import { describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { jwtToAddress } from "@mysten/sui/zklogin";
import { getMe, googleSignIn, issueNonce, listPicks, postPick, sessionAddress, signIn, type FanApiDeps } from "../src/core/fanapi.ts";
import { verifyGoogleIdToken, zkLoginSalt } from "../src/core/google.ts";
import { signToken } from "../src/core/session.ts";
import type { Series } from "../src/core/worlds.ts";
import { MemoryFanDb } from "./helpers/memory-fandb.ts";

const S = "test-secret-0123456789abcdef";
const A = "0x" + "a".repeat(64);
const B = "0x" + "b".repeat(64);
const bo3: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 3, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const later: Series = { ...bo3, matchId: "y", startTime: "2026-10-24T17:00:00Z", bestOf: 1, teamA: "T1", teamB: "BLG" };
const done: Series = { ...bo3, matchId: "z", startTime: "2026-10-22T17:00:00Z", state: "completed" };
const t = (iso: string) => new Date(iso);

function fakes(overrides: Partial<FanApiDeps> = {}) {
  const db = new MemoryFanDb();
  let clock = t("2026-10-23T12:00:00Z");
  const verified: string[] = [];
  const deps: FanApiDeps = {
    db,
    fetchSeries: async () => [later, bo3, done],
    now: () => clock,
    sessionSecret: S,
    network: "testnet",
    verifySignature: async (_bytes, signature, address) => { if (signature !== "good") throw new Error("bad signature"); verified.push(address); },
    lookupName: async () => "nikola.sui",
    ...overrides,
  };
  return { db, deps, verified, setClock: (iso: string) => (clock = t(iso)) };
}

const b64 = (s: string) => Buffer.from(s).toString("base64");

async function signedIn(deps: FanApiDeps, address = A) {
  const nonce = await issueNonce(deps, address);
  const body = nonce.body as { message: string };
  return signIn(deps, { bytes: b64(body.message), signature: "good", nonceToken: nonce.nonceToken! });
}

describe("sign-in", () => {
  it("issues a message to sign for the configured network", async () => {
    const { deps } = fakes();
    const r = await issueNonce(deps, A);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ network: "testnet" });
    expect((r.body as { message: string }).message).toContain(`Address: ${A}`);
    expect(r.nonceToken).toBeTruthy();
  });
  it("rejects an address that isn't a Sui address", async () => expect((await issueNonce(fakes().deps, "0x12")).status).toBe(400));

  it("verifies the signature, creates the fan, caches their SuiNS name and starts a session", async () => {
    const { deps, db, verified } = fakes();
    const r = await signedIn(deps);
    expect(r.status).toBe(200);
    expect(verified).toEqual([A]);
    expect(r.body).toEqual({ address: A, suinsName: "nikola.sui", displayName: "nikola.sui" });
    expect(sessionAddress(deps, r.session!)).toBe(A);
    expect((await db.getFan(A))!.suinsName).toBe("nikola.sui");
  });

  it("still signs in when the SuiNS lookup fails", async () => {
    const { deps } = fakes({ lookupName: async () => { throw new Error("down"); } });
    const r = await signedIn(deps);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ displayName: "0xaaaa…aaaa" });
  });

  it("rejects a bad signature, a missing or foreign nonce, and a stale message", async () => {
    const { deps, setClock } = fakes();
    const n = await issueNonce(deps, A);
    const msg = (n.body as { message: string }).message;
    expect((await signIn(deps, { bytes: b64(msg), signature: "bad", nonceToken: n.nonceToken! })).status).toBe(401);
    expect((await signIn(deps, { bytes: b64(msg), signature: "good", nonceToken: undefined })).status).toBe(401);
    const other = await issueNonce(deps, B);
    expect((await signIn(deps, { bytes: b64(msg), signature: "good", nonceToken: other.nonceToken! })).status).toBe(401);
    expect((await signIn(deps, { bytes: b64("hello"), signature: "good", nonceToken: n.nonceToken! })).status).toBe(400);
    setClock("2026-10-23T12:05:01Z");
    expect((await signIn(deps, { bytes: b64(msg), signature: "good", nonceToken: n.nonceToken! })).status).toBe(401);
  });

  it("ignores a session signed with another secret", () => {
    const { deps } = fakes();
    expect(sessionAddress(deps, signToken({ address: A }, "another-secret-0123456789", 60_000, deps.now()))).toBeNull();
    expect(sessionAddress(deps, undefined)).toBeNull();
  });
});

describe("Google sign-in", () => {
  const CLIENT = "kdace-test.apps.googleusercontent.com";
  const SALT_SECRET = "salt-secret-0123456789abcdef0123456789";
  const SUB = "110169484474386276334";

  async function google(overrides: Partial<FanApiDeps> = {}) {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }] });
    const f = fakes({ zkLoginSaltSecret: SALT_SECRET, ...overrides });
    f.deps.verifyGoogleToken = (t) => verifyGoogleIdToken(t, { clientId: CLIENT, jwks, now: f.deps.now() });
    const iat = Math.floor(f.deps.now().getTime() / 1000) - 10;
    const token = (aud = CLIENT) =>
      new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer("https://accounts.google.com").setAudience(aud).setSubject(SUB).setIssuedAt(iat).setExpirationTime(iat + 3600).sign(privateKey);
    return { ...f, token };
  }

  it("verifies the token, derives the zkLogin address, records salt and method, and starts a session", async () => {
    const { deps, db, token, verified } = await google();
    const idToken = await token();
    const salt = zkLoginSalt(SALT_SECRET, "https://accounts.google.com", SUB);
    const address = jwtToAddress(idToken, salt, false);
    const r = await googleSignIn(deps, { idToken });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ address, suinsName: "nikola.sui", displayName: "nikola.sui" });
    expect(sessionAddress(deps, r.session!)).toBe(address);
    expect(await db.getFan(address)).toMatchObject({ authMethod: "google", zkloginSalt: salt, suinsName: "nikola.sui" });
    expect(verified).toEqual([]); // no wallet signature involved
  });

  it("gives the same address on every sign-in", async () => {
    const { deps, token } = await google();
    const a = (await googleSignIn(deps, { idToken: await token() })).body;
    const b = (await googleSignIn(deps, { idToken: await token() })).body;
    expect(a).toEqual(b);
  });

  it("rejects a token that fails verification, and a missing token", async () => {
    const { deps, db, token } = await google();
    expect((await googleSignIn(deps, { idToken: await token("someone-else") })).status).toBe(401);
    expect((await googleSignIn(deps, { idToken: undefined })).status).toBe(400);
    expect(db.fans.size).toBe(0);
  });

  it("is unavailable until Google sign-in is configured", async () => {
    const { deps } = fakes();
    expect((await googleSignIn(deps, { idToken: "x.y.z" })).status).toBe(503);
  });

  it("records wallet sign-ins as such", async () => {
    const { deps, db } = fakes();
    await signedIn(deps);
    expect(await db.getFan(A)).toMatchObject({ authMethod: "wallet" });
  });
});

describe("postPick", () => {
  it("needs a session", async () => expect((await postPick(fakes().deps, null, { matchId: "x", market: "winner", choice: "GEN" })).status).toBe(401));

  it("stores the pick with server time, last pick wins, and returns a receipt", async () => {
    const { deps, db, setClock } = fakes();
    await signedIn(deps);
    await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN" });
    setClock("2026-10-23T13:00:00Z");
    const r = await postPick(deps, A, { matchId: "x", market: "winner", choice: "IG" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ receipt: { entry: { player: `fan:${A}`, market: "winner", choice: "IG" }, marketId: "x:fans", pickedAt: "2026-10-23T13:00:00.000Z" } });
    expect(await db.picksOf(A)).toEqual([{ matchId: "x", address: A, market: "winner", choice: "IG", updatedAt: "2026-10-23T13:00:00.000Z" }]);
  });

  it("rejects picks at lock, after the start and once the fan batch exists", async () => {
    const { deps, db, setClock } = fakes();
    setClock("2026-10-23T16:55:00Z");
    expect((await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN" })).status).toBe(409);
    setClock("2026-10-23T12:00:00Z");
    await db.insertCommit({ matchId: "x", status: "committing", batch: null, batchHash: null, pickCount: 0, commitDigest: null, network: "testnet", packageId: "0x1", committedAt: null, attemptedAt: "t" });
    expect((await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN" })).status).toBe(409);
    expect((await postPick(deps, A, { matchId: "z", market: "winner", choice: "GEN" })).status).toBe(409);
    expect(await db.picksOf(A)).toEqual([]);
  });

  it.each([
    ["a team outside the match", { matchId: "x", market: "winner", choice: "T1" }, 400],
    ["a score on Bo1", { matchId: "y", market: "score", choice: "1-0" }, 400],
    ["an unknown series", { matchId: "nope", market: "winner", choice: "GEN" }, 404],
    ["a malformed body", { matchId: 5 }, 400],
  ])("rejects %s", async (_n, body, status) => {
    expect((await postPick(fakes().deps, A, body)).status).toBe(status);
  });
});

describe("listPicks", () => {
  it("lists open series with the crowd split and the fan's own picks", async () => {
    const { deps } = fakes();
    await signedIn(deps, A);
    await signedIn(deps, B);
    await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN" });
    await postPick(deps, A, { matchId: "x", market: "score", choice: "2-0" });
    await postPick(deps, B, { matchId: "x", market: "winner", choice: "IG" });
    const r = await listPicks(deps, A);
    const body = r.body as { serverTime: string; series: { series: Series; lockAt: string; crowd: unknown; mine: unknown }[] };
    expect(body.serverTime).toBe("2026-10-23T12:00:00.000Z");
    expect(body.series.map((s) => s.series.matchId)).toEqual(["x", "y"]);
    expect(body.series[0]).toMatchObject({ lockAt: "2026-10-23T16:55:00.000Z", crowd: { fans: 2, winner: { GEN: 1, IG: 1 }, score: { "2-0": 1 } }, mine: { winner: "GEN", score: "2-0" } });
    expect((await listPicks(deps, null)).body).toMatchObject({ series: [{ mine: {} }, { mine: {} }] });
  });
});

describe("getMe", () => {
  it("returns the fan's name and picks", async () => {
    const { deps } = fakes();
    await signedIn(deps);
    await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN" });
    const r = await getMe(deps, A);
    expect(r.body).toMatchObject({ address: A, displayName: "nikola.sui", picks: [{ matchId: "x", choice: "GEN" }] });
    expect((await getMe(deps, null)).status).toBe(401);
  });
});
