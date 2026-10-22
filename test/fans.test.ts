import { describe, expect, it } from "vitest";
import { crowdSplit, displayName, fanEntries, fanMarketId, fanPlayer, lockAt, pickReceipt, shortAddress, validateFanPick, type FanPickRow } from "../src/core/fans.ts";
import type { Series } from "../src/core/worlds.ts";

const bo3: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 3, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const bo1: Series = { ...bo3, bestOf: 1 };
const early = new Date("2026-10-23T12:00:00Z");
const A = "0x" + "a".repeat(64);
const B = "0x" + "b".repeat(64);
const row = (address: string, market: "winner" | "score", choice: string, updatedAt = "2026-10-23T12:00:00.000Z", stake = 100): FanPickRow => ({ matchId: "x", address, market, choice, stake, updatedAt });

describe("fan ids", () => {
  it("prefixes the player id and suffixes the market id", () => {
    expect(fanPlayer(A)).toBe(`fan:${A}`);
    expect(fanMarketId("x")).toBe("x:fans");
  });
  it("locks 5 minutes before the start", () => expect(lockAt("2026-10-23T17:00:00Z")).toBe("2026-10-23T16:55:00.000Z"));
});

describe("validateFanPick", () => {
  it("accepts a team as winner and a valid score on Bo3", () => {
    expect(validateFanPick(bo3, "winner", "IG", 10, early)).toBeNull();
    expect(validateFanPick(bo3, "score", "2-1", 2500, early)).toBeNull();
  });
  it.each([
    ["an unknown series", undefined, "winner", "GEN", 100, early],
    ["a team outside the match", bo3, "winner", "T1", 100, early],
    ["an impossible score", bo3, "score", "3-1", 100, early],
    ["a score on Bo1", bo1, "score", "1-0", 100, early],
    ["an unknown market", bo3, "mvp", "Chovy", 100, early],
    ["TBD teams", { ...bo3, teamA: "TBD" }, "winner", "IG", 100, early],
    ["a series already started", { ...bo3, state: "inProgress" as const }, "winner", "IG", 100, early],
    ["the exact lock time", bo3, "winner", "IG", 100, new Date("2026-10-23T16:55:00Z")],
    ["a stake under 10", bo3, "winner", "IG", 9, early],
    ["a fractional stake", bo3, "winner", "IG", 10.5, early],
    ["a missing stake", bo3, "winner", "IG", undefined, early],
    ["a stake given as text", bo3, "winner", "IG", "100", early],
  ])("rejects %s", (_n, s, market, choice, stake, now) => {
    expect(validateFanPick(s as Series | undefined, market as string, choice as string, stake, now as Date)).toMatch(/./);
  });
  it("explains the stake rule in plain words", () => expect(validateFanPick(bo3, "winner", "IG", 5, early)).toBe("Stakes are whole AXP amounts, at least 10."));
  it("accepts one second before lock", () => expect(validateFanPick(bo3, "winner", "IG", 100, new Date("2026-10-23T16:54:59Z"))).toBeNull());
});

describe("fanEntries", () => {
  it("turns final pre-lock picks into batch entries", () => {
    expect(fanEntries(bo3, [row(A, "winner", "GEN", undefined, 500), row(A, "score", "2-0"), row(B, "winner", "IG")])).toEqual([
      { player: `fan:${A}`, market: "winner", choice: "GEN", stake: 500 },
      { player: `fan:${A}`, market: "score", choice: "2-0", stake: 100 },
      { player: `fan:${B}`, market: "winner", choice: "IG", stake: 100 },
    ]);
  });
  it("drops picks stamped at or after lock, other matches, invalid choices and Bo1 scores", () => {
    const rows = [row(A, "winner", "GEN", "2026-10-23T16:55:00.000Z"), { ...row(B, "winner", "IG"), matchId: "y" }, row(B, "winner", "T1"), row(B, "score", "1-0")];
    expect(fanEntries(bo3, rows)).toEqual([]);
    expect(fanEntries(bo1, [row(A, "winner", "GEN"), row(A, "score", "2-0")])).toEqual([{ player: `fan:${A}`, market: "winner", choice: "GEN", stake: 100 }]);
    expect(fanEntries(bo3, [row(A, "winner", "GEN", undefined, 5)])).toEqual([]);
  });
});

describe("crowdSplit", () => {
  it("counts fans, their choices and the AXP pool per outcome", () => {
    expect(crowdSplit(bo3, [row(A, "winner", "GEN", undefined, 300), row(A, "score", "2-0", undefined, 50), row(B, "winner", "GEN")])).toEqual({
      fans: 2, winner: { GEN: 2, IG: 0 }, score: { "2-0": 1 }, winnerPool: { GEN: 400, IG: 0 }, scorePool: { "2-0": 50 },
    });
  });
});

describe("pickReceipt", () => {
  it("carries the batch entry and where to find the committed batch", () => {
    const r = pickReceipt(bo3, row(A, "winner", "GEN"));
    expect(r).toMatchObject({ entry: { player: `fan:${A}`, market: "winner", choice: "GEN", stake: 100 }, marketId: "x:fans", lockAt: "2026-10-23T16:55:00.000Z", pickedAt: "2026-10-23T12:00:00.000Z" });
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
