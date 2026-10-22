import { describe, expect, it } from "vitest";
import { newNonce, parseSignInMessage, readToken, signInMessage, signToken } from "../src/core/session.ts";

const now = new Date("2026-10-23T12:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);
const S = "test-secret-0123456789abcdef";
const A = "0x" + "a".repeat(64);

describe("signed tokens", () => {
  it("round-trips a payload until it expires", () => {
    const t = signToken({ address: A }, S, 60_000, now);
    expect(readToken<{ address: string }>(t, S, later(59_000))?.address).toBe(A);
    expect(readToken(t, S, later(60_000))).toBeNull();
  });
  it("rejects a wrong secret, a tampered payload and garbage", () => {
    const t = signToken({ address: A }, S, 60_000, now);
    expect(readToken(t, "another-secret-of-length", now)).toBeNull();
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ address: "0xevil", exp: later(60_000).getTime() })).toString("base64url");
    expect(readToken(`${forged}.${mac}`, S, now)).toBeNull();
    expect(readToken(`${body}.`, S, now)).toBeNull();
    expect(readToken("nope", S, now)).toBeNull();
    expect(readToken(undefined, S, now)).toBeNull();
  });
  it("refuses to sign without a real secret", () => expect(() => signToken({}, "", 1000, now)).toThrow());
});

describe("sign-in message", () => {
  it("is human readable and parses back", () => {
    const text = signInMessage({ address: A, nonce: "n1", issuedAt: now.toISOString() });
    expect(text.startsWith("KDAce sign-in")).toBe(true);
    expect(parseSignInMessage(text)).toEqual({ address: A, nonce: "n1", issuedAt: now.toISOString() });
  });
  it("returns null for anything else", () => expect(parseSignInMessage("hello")).toBeNull());
  it("makes unpredictable nonces", () => {
    expect(newNonce()).toMatch(/^[0-9a-f]{32}$/);
    expect(newNonce()).not.toBe(newNonce());
  });
});
