// "Sign in with Google" without Enoki and without a ZK prover: KDAce verifies the Google ID token itself, derives the
// fan's zkLogin salt from a server secret, and computes the zkLogin address. Fans never sign Sui transactions, so the
// address is all KDAce needs. Any zkLogin prover given the same salt reaches the same address on any network.
import { createHmac } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { jwtToAddress } from "@mysten/sui/zklogin";

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const SKEW_SECONDS = 60;

export type GoogleIdentity = { iss: string; sub: string; aud: string };

/** Google's signing keys, fetched on first use and cached (jose refetches on an unknown kid, at most every 30 s). */
let googleKeys: JWTVerifyGetKey | null = null;
export const googleJwks = (): JWTVerifyGetKey => (googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)));

/**
 * Verifies a Google ID token: RS256 signature against Google's keys, issuer, audience (our client ID), and
 * exp/iat with a minute of clock skew. `email_verified` is not required: the address hangs off `sub`, not the email.
 */
export async function verifyGoogleIdToken(idToken: string, opts: { clientId: string; jwks?: JWTVerifyGetKey; now?: Date }): Promise<GoogleIdentity> {
  if (!opts.clientId) throw new Error("GOOGLE_CLIENT_ID is not set");
  const { payload } = await jwtVerify(idToken, opts.jwks ?? googleJwks(), {
    algorithms: ["RS256"],
    issuer: GOOGLE_ISSUERS,
    audience: opts.clientId,
    clockTolerance: SKEW_SECONDS,
    maxTokenAge: "1h",
    requiredClaims: ["sub", "iat", "exp"],
    currentDate: opts.now,
  });
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("token has no subject");
  return { iss: payload.iss!, sub: payload.sub, aud: opts.clientId };
}

/** zkLogin normalizes the bare Google issuer to its https form; the salt does too, so both spellings are one account. */
const normalizeIssuer = (iss: string) => (iss === "accounts.google.com" ? "https://accounts.google.com" : iss);

/**
 * The fan's zkLogin salt: HMAC-SHA256(secret, "iss|sub") truncated to 16 bytes, so it is below 2^128 like the salts
 * Mysten's salt service hands out. Deterministic: the secret alone recovers every Google fan's address.
 * Returned as a decimal string, the form zkLogin tooling takes.
 */
export function zkLoginSalt(secret: string, iss: string, sub: string): string {
  if (!secret || secret.length < 32) throw new Error("ZKLOGIN_SALT_SECRET must be set (at least 32 characters)");
  const mac = createHmac("sha256", secret).update(`${normalizeIssuer(iss)}|${sub}`).digest();
  return BigInt(`0x${mac.subarray(0, 16).toString("hex")}`).toString();
}

/** The zkLogin address for this token and salt (current, padded form: legacyAddress = false). */
export const googleAddress = (idToken: string, salt: string): string => jwtToAddress(idToken, salt, false);
