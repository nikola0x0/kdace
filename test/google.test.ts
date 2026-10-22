import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { jwtToAddress } from "@mysten/sui/zklogin";
import { beforeAll, describe, expect, it } from "vitest";
import { googleAddress, verifyGoogleIdToken, zkLoginSalt } from "../src/core/google.ts";

const CLIENT = "kdace-test.apps.googleusercontent.com";
const NOW = new Date("2026-10-23T12:00:00Z");
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

let jwk: JWK, privateKey: CryptoKey, otherKey: CryptoKey;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  otherKey = (await generateKeyPair("RS256")).privateKey;
});

const jwks = () => createLocalJWKSet({ keys: [jwk] });

type Claims = { iss?: string; aud?: string; sub?: string; iat?: number; exp?: number };
async function token(claims: Claims = {}, key: CryptoKey = privateKey) {
  const c = { iss: "https://accounts.google.com", aud: CLIENT, sub: "110169484474386276334", iat: sec(NOW) - 60, exp: sec(NOW) + 3540, ...claims };
  return new SignJWT({ email: "fan@example.com", email_verified: false })
    .setProtectedHeader({ alg: "RS256", kid: "k1", typ: "JWT" })
    .setIssuer(c.iss).setAudience(c.aud).setSubject(c.sub).setIssuedAt(c.iat).setExpirationTime(c.exp)
    .sign(key);
}

const verify = (t: string, now = NOW) => verifyGoogleIdToken(t, { clientId: CLIENT, jwks: jwks(), now });

describe("verifyGoogleIdToken", () => {
  it("accepts a valid token (email_verified not required) and returns iss and sub", async () => {
    expect(await verify(await token())).toEqual({ iss: "https://accounts.google.com", sub: "110169484474386276334" });
  });
  it("accepts the bare accounts.google.com issuer", async () => {
    expect((await verify(await token({ iss: "accounts.google.com" }))).iss).toBe("accounts.google.com");
  });
  it("rejects a token for another client", async () => {
    await expect(verify(await token({ aud: "someone-else.apps.googleusercontent.com" }))).rejects.toThrow();
  });
  it("rejects another issuer", async () => {
    await expect(verify(await token({ iss: "https://evil.example.com" }))).rejects.toThrow();
  });
  it("rejects an expired token, with a minute of skew allowed", async () => {
    const t = await token({ iat: sec(NOW) - 3700, exp: sec(NOW) - 100 });
    await expect(verify(t)).rejects.toThrow();
    const justExpired = await token({ iat: sec(NOW) - 3600, exp: sec(NOW) - 30 });
    await expect(verify(justExpired)).resolves.toBeTruthy();
  });
  it("rejects a token issued in the future", async () => {
    await expect(verify(await token({ iat: sec(NOW) + 600, exp: sec(NOW) + 4200 }))).rejects.toThrow();
  });
  it("rejects a bad signature", async () => {
    await expect(verify(await token({}, otherKey))).rejects.toThrow();
    const [h, p] = (await token()).split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "someone-else" })).toString("base64url");
    await expect(verify(`${h}.${forged}.${(await token()).split(".")[2]}`)).rejects.toThrow();
  });
  it("keeps the claims out of its errors", async () => {
    const err = await verify(await token({ aud: "someone-else.apps.googleusercontent.com" })).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(Object.keys(err)).toEqual([]); // no payload/claim properties attached
    expect(String(err.message)).not.toContain("110169484474386276334");
    expect(String(err.message)).not.toContain("fan@example.com");
  });
  it("rejects garbage and unsigned tokens", async () => {
    await expect(verify("not-a-jwt")).rejects.toThrow();
    const [, p] = (await token()).split(".");
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    await expect(verify(`${none}.${p}.`)).rejects.toThrow();
  });
});

describe("zkLoginSalt", () => {
  const SECRET = "salt-secret-0123456789abcdef0123456789";
  it("is deterministic, depends on the secret and the subject, and is below 2^128", () => {
    const a = zkLoginSalt(SECRET, "https://accounts.google.com", "1");
    expect(zkLoginSalt(SECRET, "https://accounts.google.com", "1")).toBe(a);
    expect(zkLoginSalt(SECRET, "https://accounts.google.com", "2")).not.toBe(a);
    expect(zkLoginSalt(SECRET + "x", "https://accounts.google.com", "1")).not.toBe(a);
    for (let i = 0; i < 200; i++) {
      const s = BigInt(zkLoginSalt(SECRET, "https://accounts.google.com", String(i)));
      expect(s >= 0n && s < 2n ** 128n).toBe(true);
    }
    expect(a).toMatch(/^[0-9]+$/);
  });
  it("treats both Google issuer spellings as the same account", () => {
    expect(zkLoginSalt(SECRET, "accounts.google.com", "1")).toBe(zkLoginSalt(SECRET, "https://accounts.google.com", "1"));
  });
  it("refuses a missing or short secret", () => {
    expect(() => zkLoginSalt("", "https://accounts.google.com", "1")).toThrow(/ZKLOGIN_SALT_SECRET/);
    expect(() => zkLoginSalt("short", "https://accounts.google.com", "1")).toThrow(/ZKLOGIN_SALT_SECRET/);
  });
});

describe("googleAddress", () => {
  it("is the zkLogin address jwtToAddress gives for the token and salt", async () => {
    const t = await token();
    const salt = zkLoginSalt("salt-secret-0123456789abcdef0123456789", "https://accounts.google.com", "110169484474386276334");
    const address = googleAddress(t, salt);
    expect(address).toBe(jwtToAddress(t, salt, false));
    expect(address).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("matches a fixed fixture address (guards against SDK derivation changes)", () => {
    // Unsigned fixture: only the claims matter for the address.
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const t = `${enc({ alg: "RS256", kid: "k1", typ: "JWT" })}.${enc({ iss: "https://accounts.google.com", aud: CLIENT, sub: "110169484474386276334", iat: 1, exp: 2 })}.sig`;
    expect(googleAddress(t, "12345678901234567890")).toBe(jwtToAddress(t, "12345678901234567890", false));
    expect(googleAddress(t, "12345678901234567890")).toMatchInlineSnapshot(`"0xe525765fd7040adbdd2ef5cf016a78bd820012cdb2f90bdd00b5b1cf38b258d0"`);
  });
});
