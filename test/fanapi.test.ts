import { describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { jwtToAddress } from "@mysten/sui/zklogin";
import { activity, getMe, setAvatar, setFavRole, googleSignIn, issueNonce, leaderboardFans, listPicks, postPick, sessionAddress, signIn, type FanApiDeps } from "../src/core/fanapi.ts";
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
    const token = (aud = CLIENT, claims: Record<string, unknown> = {}) =>
      new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer("https://accounts.google.com").setAudience(aud).setSubject(SUB).setIssuedAt(iat).setExpirationTime(iat + 3600).sign(privateKey);
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

  it("keeps the Google profile photo, but only from Google's image host", async () => {
    const { deps, db, token } = await google();
    const pic = "https://lh3.googleusercontent.com/a/abc123=s96-c";
    const r = await googleSignIn(deps, { idToken: await token(CLIENT, { picture: pic }) });
    const address = (r.body as { address: string }).address;
    expect((await db.getFan(address))?.avatarUrl).toBe(pic);
    await googleSignIn(deps, { idToken: await token(CLIENT, { picture: "https://evil.example/x.png" }) });
    expect((await db.getFan(address))?.avatarUrl).toBe(pic);
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
  it("needs a session", async () => expect((await postPick(fakes().deps, null, { matchId: "x", market: "winner", choice: "GEN", stake: 100 })).status).toBe(401));

  it("adds each buy to the fan's position on that outcome, and a buy on the other side opens a second position", async () => {
    const { deps, db, setClock } = fakes();
    await signedIn(deps);
    await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 10 });
    setClock("2026-10-23T13:00:00Z");
    const r = await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 90 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ receipt: { entry: { player: `fan:${A}`, market: "winner", choice: "GEN", stake: 100 }, marketId: "x:fans", pickedAt: "2026-10-23T13:00:00.000Z" } });
    await postPick(deps, A, { matchId: "x", market: "winner", choice: "IG", stake: 50 });
    expect(await db.picksOf(A)).toEqual([
      { matchId: "x", address: A, market: "winner", choice: "GEN", stake: 100, updatedAt: "2026-10-23T13:00:00.000Z" },
      { matchId: "x", address: A, market: "winner", choice: "IG", stake: 50, updatedAt: "2026-10-23T13:00:00.000Z" },
    ]);
  });

  it("rejects picks at lock, after the start and once the fan batch exists", async () => {
    const { deps, db, setClock } = fakes();
    setClock("2026-10-23T16:55:00Z");
    expect((await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 100 })).status).toBe(409);
    setClock("2026-10-23T12:00:00Z");
    await db.insertCommit({ matchId: "x", status: "committing", batch: null, batchHash: null, pickCount: 0, commitDigest: null, network: "testnet", packageId: "0x1", committedAt: null, attemptedAt: "t" });
    expect((await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 100 })).status).toBe(409);
    expect((await postPick(deps, A, { matchId: "z", market: "winner", choice: "GEN", stake: 100 })).status).toBe(409);
    expect(await db.picksOf(A)).toEqual([]);
  });

  it.each([
    ["a team outside the match", { matchId: "x", market: "winner", choice: "T1", stake: 100 }, 400],
    ["a score on Bo1", { matchId: "y", market: "score", choice: "1-0", stake: 100 }, 400],
    ["an unknown series", { matchId: "nope", market: "winner", choice: "GEN", stake: 100 }, 404],
    ["a malformed body", { matchId: 5 }, 400],
    ["a missing stake", { matchId: "x", market: "winner", choice: "GEN" }, 400],
    ["a stake under 10", { matchId: "x", market: "winner", choice: "GEN", stake: 9 }, 400],
    ["a fractional stake", { matchId: "x", market: "winner", choice: "GEN", stake: 12.5 }, 400],
  ])("rejects %s", async (_n, body, status) => {
    expect((await postPick(fakes().deps, A, body)).status).toBe(status);
  });

  it("rejects a stake above the fan's available AXP, in plain words", async () => {
    const { deps, db } = fakes();
    await signedIn(deps);
    await db.setAxpSettled({ [A]: -1660 }); // balance 8,340
    await postPick(deps, A, { matchId: "y", market: "winner", choice: "T1", stake: 6000 }); // open elsewhere
    const r = await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 2341 });
    expect(r).toMatchObject({ status: 400, body: { error: "You only have 2,340 AXP available." } });
    expect((await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 2340 })).status).toBe(200);
  });

  it("counts every buy against the fan's available AXP", async () => {
    const { deps } = fakes();
    await signedIn(deps);
    expect((await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 6000 })).status).toBe(200);
    expect((await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 4001 })).status).toBe(400);
    expect((await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 4000 })).status).toBe(200);
  });

  it("frees stakes in settled or missed fan batches and in series that ended without one", async () => {
    const { deps, db } = fakes({ fetchSeries: async () => [later, bo3, done, { ...done, matchId: "w" }, { ...done, matchId: "v" }] });
    await signedIn(deps);
    const old = (matchId: string, stake: number) => db.upsertPick({ matchId, address: A, market: "winner", choice: "GEN", stake, updatedAt: "2026-10-22T12:00:00.000Z" });
    const commit = (matchId: string, status: "committed" | "missed", settledAt: string | null) =>
      db.insertCommit({ matchId, status, batch: "{}", batchHash: "h", pickCount: 1, commitDigest: "d", network: "testnet", packageId: "0x1", committedAt: "t", attemptedAt: "t", settledAt });
    await old("z", 4000);
    await commit("z", "committed", "2026-10-23T00:00:00.000Z"); // settled: counted in axp_settled instead
    await old("w", 3000);
    await commit("w", "missed", null); // never on chain: refunded
    await old("v", 2000); // completed, no fan batch: refunded
    await old("u", 500); // committed, waiting for its result: still open
    await commit("u", "committed", null);
    const r = await getMe(deps, A);
    expect((r.body as { axp: unknown }).axp).toEqual({ start: 10000, settled: 0, open: 500, available: 9500 });
  });
});

describe("listPicks", () => {
  it("lists open series with the crowd split, AXP pools and the fan's own picks with stakes", async () => {
    const { deps } = fakes();
    await signedIn(deps, A);
    await signedIn(deps, B);
    await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 300 });
    await postPick(deps, A, { matchId: "x", market: "score", choice: "2-0", stake: 50 });
    await postPick(deps, B, { matchId: "x", market: "winner", choice: "IG", stake: 120 });
    const r = await listPicks(deps, A);
    const body = r.body as { serverTime: string; series: { series: Series; lockAt: string; crowd: unknown; mine: unknown }[] };
    expect(body.serverTime).toBe("2026-10-23T12:00:00.000Z");
    expect(body.series.map((s) => s.series.matchId)).toEqual(["x", "y"]);
    expect(body.series[0]).toMatchObject({
      lockAt: "2026-10-23T16:55:00.000Z",
      crowd: { fans: 2, winner: { GEN: 1, IG: 1 }, score: { "2-0": 1 }, winnerPool: { GEN: 300, IG: 120 }, scorePool: { "2-0": 50 } },
      mine: { winner: { GEN: 300 }, score: { "2-0": 50 } },
    });
    expect((await listPicks(deps, null)).body).toMatchObject({ series: [{ mine: {} }, { mine: {} }] });
  });
});

describe("getMe", () => {
  it("returns the fan's name, picks with stakes, and AXP", async () => {
    const { deps, db } = fakes();
    await signedIn(deps);
    await db.setAxpSettled({ [A]: 750 });
    await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 400 });
    const r = await getMe(deps, A);
    expect(r.body).toEqual({
      address: A, suinsName: "nikola.sui", displayName: "nikola.sui", avatarUrl: null, favRole: null,
      picks: [{ matchId: "x", market: "winner", choice: "GEN", stake: 400, updatedAt: "2026-10-23T12:00:00.000Z" }],
      axp: { start: 10000, settled: 750, open: 400, available: 10350 },
    });
    expect((await getMe(deps, null)).status).toBe(401);
  });
});

describe("setFavRole", () => {
  it("saves the role a fan cheers for, shows it on their profile, and clears it with null", async () => {
    const { deps } = fakes();
    await signedIn(deps);
    expect((await setFavRole(deps, A, { favRole: "adc" })).body).toEqual({ favRole: "adc" });
    expect((await getMe(deps, A)).body).toMatchObject({ favRole: "adc" });
    expect((await leaderboardFans(deps)).body).toMatchObject({ fans: [{ address: A, favRole: "adc" }] });
    expect((await setFavRole(deps, A, { favRole: null })).body).toEqual({ favRole: null });
    expect((await getMe(deps, A)).body).toMatchObject({ favRole: null });
  });
  it("rejects anything that isn't one of the five roles, and signed-out callers", async () => {
    const { deps } = fakes();
    await signedIn(deps);
    expect((await setFavRole(deps, A, { favRole: "coach" })).status).toBe(400);
    expect((await setFavRole(deps, A, {})).status).toBe(400);
    expect((await setFavRole(deps, null, { favRole: "mid" })).status).toBe(401);
  });
});

describe("setAvatar", () => {
  const webp = (size = 64) => `data:image/webp;base64,${Buffer.concat([Buffer.from("RIFF0000WEBPVP8 "), Buffer.alloc(size)]).toString("base64")}`;
  it("stores an uploaded photo, keeps it over the Google photo on the next sign-in, and clears with null", async () => {
    const { deps, db } = fakes();
    await signedIn(deps);
    const r = await setAvatar(deps, A, { image: webp() });
    expect(r.status).toBe(200);
    const url = (r.body as { avatarUrl: string }).avatarUrl;
    expect(url).toContain("/avatars/");
    expect((await getMe(deps, A)).body).toMatchObject({ avatarUrl: url });
    await db.ensureFan(A, { method: "google", avatarUrl: "https://lh3.googleusercontent.com/new" });
    expect((await db.getFan(A))?.avatarUrl).toBe(url);
    expect((await setAvatar(deps, A, { image: null })).body).toEqual({ avatarUrl: null });
  });
  it("rejects files that aren't images, are too big, or callers who aren't signed in", async () => {
    const { deps } = fakes();
    await signedIn(deps);
    expect((await setAvatar(deps, A, { image: "data:image/webp;base64," + Buffer.from("<svg onload=x>").toString("base64") })).status).toBe(400);
    expect((await setAvatar(deps, A, { image: "data:image/svg+xml;base64,PHN2Zz4=" })).status).toBe(400);
    expect((await setAvatar(deps, A, { image: webp(300_000) })).status).toBe(400);
    expect((await setAvatar(deps, A, {})).status).toBe(400);
    expect((await setAvatar(deps, null, { image: webp() })).status).toBe(401);
  });
});

describe("leaderboardFans", () => {
  it("lists every signed-in fan at 10,000 AXP plus settled results, with AXP in open positions", async () => {
    const { deps, db } = fakes();
    await signedIn(deps, A);
    await signedIn(deps, B);
    await db.setAxpSettled({ [B]: 420 });
    await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 300 });
    const r = await leaderboardFans(deps);
    expect(r.status).toBe(200);
    expect((r.body as { fans: unknown[] }).fans).toEqual(expect.arrayContaining([
      { address: A, displayName: "nikola.sui", avatarUrl: null, favRole: null, total: 10000, balance: 9700, net: 0, inPlay: 300 },
      expect.objectContaining({ address: B, total: 10420, balance: 10420, net: 420, inPlay: 0 }),
    ]));
  });
});

describe("activity", () => {
  it("lists recent buys newest first with display names, optionally for one match", async () => {
    const { deps, setClock } = fakes();
    await signedIn(deps, A);
    await signedIn(deps, B);
    await postPick(deps, A, { matchId: "x", market: "winner", choice: "GEN", stake: 100 });
    setClock("2026-10-23T12:05:00Z");
    await postPick(deps, B, { matchId: "y", market: "winner", choice: "T1", stake: 250 });
    const all = (await activity(deps, {})).body as { buys: { name: string; matchId: string; choice: string; amount: number; at: string }[] };
    expect(all.buys.map((b) => [b.matchId, b.choice, b.amount])).toEqual([["y", "T1", 250], ["x", "GEN", 100]]);
    expect(all.buys[1].name).toBe("nikola.sui");
    const one = (await activity(deps, { matchId: "x" })).body as { buys: unknown[] };
    expect(one.buys).toHaveLength(1);
  });
});

