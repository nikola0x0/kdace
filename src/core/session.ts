// Fan sessions: HMAC-signed tokens for httpOnly cookies, and the personal message a fan signs to sign in.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const mac = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function signToken(payload: object, secret: string, ttlMs: number, now: Date): string {
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters)");
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now.getTime() + ttlMs })).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function readToken<T extends object>(token: string | undefined, secret: string, now: Date): (T & { exp: number }) | null {
  if (!token || !secret) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(mac(body, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof payload?.exp === "number" && payload.exp > now.getTime() ? payload : null;
  } catch {
    return null;
  }
}

export const newNonce = () => randomBytes(16).toString("hex");

export type SignIn = { address: string; nonce: string; issuedAt: string };

export const signInMessage = ({ address, nonce, issuedAt }: SignIn) =>
  `KDAce sign-in\n\nSign this message to prove you own this address. It costs nothing and sends no transaction.\n\nAddress: ${address}\nNonce: ${nonce}\nIssued at: ${issuedAt}`;

export function parseSignInMessage(text: string): SignIn | null {
  if (!text.startsWith("KDAce sign-in\n")) return null;
  const field = (name: string) => text.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];
  const address = field("Address"), nonce = field("Nonce"), issuedAt = field("Issued at");
  return address && nonce && issuedAt ? { address, nonce, issuedAt } : null;
}
