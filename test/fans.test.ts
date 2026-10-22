import { describe, expect, it } from "vitest";
import { crowdSplit, displayName, fanEntries, fanMarketId, fanPlayer, lockAt, pickReceipt, shortAddress, validateFanPick, type FanPickRow } from "../src/core/fans.ts";
import type { Series } from "../src/core/worlds.ts";

const bo3: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 3, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const bo1: Series = { ...bo3, bestOf: 1 };
const early = new Date("2026-10-23T12:00:00Z");
const A = "0x" + "a".repeat(64);
const B = "0x" + "b".repeat(64);
const row = (address: string, market: "winner" | "score", choice: string, updatedAt = "2026-10-23T12:00:00.000Z"): FanPickRow => ({ matchId: "x", address, market, choice, updatedAt });

describe("fan ids", () => {
  it("prefixes the player id and suffixes the market id", () => {
    expect(fanPlayer(A)).toBe(`fan:${A}`);
    expect(fanMarketId("x")).toBe("x:fans");
  });
  it("locks 5 minutes before the start", () => expect(lockAt("2026-10-23T17:00:00Z")).toBe("2026-10-23T16:55:00.000Z"));
});

describe("validateFanPick", () => {
  it("accepts a team as winner and a valid score on Bo3", () => {
    expect(validateFanPick(bo3, "winner", "IG", early)).toBeNull();
    expect(validateFanPick(bo3, "score", "2-1", early)).toBeNull();
  });
  it.each([
    ["an unknown series", undefined, "winner", "GEN", early],
    ["a team outside the match", bo3, "winner", "T1", early],
    ["an impossible score", bo3, "score", "3-1", early],
    ["a score on Bo1", bo1, "score", "1-0", early],
    ["an unknown market", bo3, "mvp", "Chovy", early],
    ["TBD teams", { ...bo3, teamA: "TBD" }, "winner", "IG", early],
    ["a series already started", { ...bo3, state: "inProgress" as const }, "winner", "IG", early],
    ["the exact lock time", bo3, "winner", "IG", new Date("2026-10-23T16:55:00Z")],
  ])("rejects %s", (_n, s, market, choice, now) => {
    expect(validateFanPick(s as Series | undefined, market as string, choice as string, now as Date)).toMatch(/./);
  });
  it("accepts one second before lock", () => expect(validateFanPick(bo3, "winner", "IG", new Date("2026-10-23T16:54:59Z"))).toBeNull());
});

describe("fanEntries", () => {
  it("turns final pre-lock picks into batch entries", () => {
    expect(fanEntries(bo3, [row(A, "winner", "GEN"), row(A, "score", "2-0"), row(B, "winner", "IG")])).toEqual([
      { player: `fan:${A}`, market: "winner", choice: "GEN" },
      { player: `fan:${A}`, market: "score", choice: "2-0" },
      { player: `fan:${B}`, market: "winner", choice: "IG" },
    ]);
  });
  it("drops picks stamped at or after lock, other matches, invalid choices and Bo1 scores", () => {
    const rows = [row(A, "winner", "GEN", "2026-10-23T16:55:00.000Z"), { ...row(B, "winner", "IG"), matchId: "y" }, row(B, "winner", "T1"), row(B, "score", "1-0")];
    expect(fanEntries(bo3, rows)).toEqual([]);
    expect(fanEntries(bo1, [row(A, "winner", "GEN"), row(A, "score", "2-0")])).toEqual([{ player: `fan:${A}`, market: "winner", choice: "GEN" }]);
  });
});

describe("crowdSplit", () => {
  it("counts fans and their choices per market", () => {
    expect(crowdSplit(bo3, [row(A, "winner", "GEN"), row(A, "score", "2-0"), row(B, "winner", "GEN")])).toEqual({ fans: 2, winner: { GEN: 2, IG: 0 }, score: { "2-0": 1 } });
  });
});

describe("pickReceipt", () => {
  it("carries the batch entry and where to find the committed batch", () => {
    const r = pickReceipt(bo3, row(A, "winner", "GEN"));
    expect(r).toMatchObject({ entry: { player: `fan:${A}`, market: "winner", choice: "GEN" }, marketId: "x:fans", lockAt: "2026-10-23T16:55:00.000Z", pickedAt: "2026-10-23T12:00:00.000Z" });
    expect(r.howToCheck).toContain("x:fans");
  });
});

describe("display", () => {
  it("shortens an address", () => expect(shortAddress("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef")).toBe("0x1234…cdef"));
  it("prefers the SuiNS name", () => {
    expect(displayName(A, "nikola.sui")).toBe("nikola.sui");
    expect(displayName(A, null)).toBe("0xaaaa…aaaa");
    expect(displayName(`fan:${A}`)).toBe("0xaaaa…aaaa");
  });
});
