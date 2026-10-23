// The in-browser verifier (web/lib/verify.ts), run against a faked Sui GraphQL endpoint.
import { afterEach, describe, expect, it, vi } from "vitest";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";
import { verifySeries, type VerifyInput } from "../web/lib/verify.ts";

const PKG = "0xpkg";
const START = "2026-10-23T17:00:00Z";
const analystBatch = canonicalBatch("x", [{ player: "analyst-top", market: "winner", choice: "GEN", stake: 1000 }, { player: "analyst-mid", market: "winner", choice: "IG", stake: 800 }]);
const finalBatch = canonicalBatch("x:final", [{ player: "analyst-top", market: "winner", choice: "GEN", stake: 600 }]);
const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");
const ms = (iso: string) => String(Date.parse(iso));

type Ev = { type: string; json: Record<string, string> };
function chain(txs: Record<string, Ev[]>) {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const digest = /digest: "([^"]+)"/.exec(JSON.parse(String(init.body)).query)![1];
    const evs = txs[digest];
    const body = evs ? { data: { transaction: { effects: { timestamp: null, events: { nodes: evs.map((e) => ({ contents: { type: { repr: e.type }, json: e.json } })) } } } } } : { data: { transaction: null } };
    return new Response(JSON.stringify(body));
  });
}
const committed = (marketId: string, batch: string, at: string): Ev => ({ type: `${PKG}::ledger::BatchCommitted`, json: { market_id: marketId, batch_hash: b64(batchHash(batch)), committed_at_ms: ms(at) } });
const posted = (winner: string, score: string): Ev => ({ type: `${PKG}::ledger::ResultPosted`, json: { market_id: "x", winner, score } });

const base: VerifyInput = {
  network: "mainnet", packageId: PKG, matchId: "x", startTime: START, batch: analystBatch, commitDigest: "c", fansBatch: null, fansDigest: null, result: null,
};
const withFinal: VerifyInput = { ...base, finalBatch, finalDigest: "f", finalCalls: [{ player: "analyst-top", add: 600, side: "GEN" }, { player: "analyst-mid", add: 0, side: "IG" }] };

afterEach(() => vi.unstubAllGlobals());

describe("verifySeries: final call", () => {
  it("checks the top-ups' fingerprint, timing, entries and side", async () => {
    chain({ c: [committed("x", analystBatch, "2026-10-23T09:00:00Z")], f: [committed("x:final", finalBatch, "2026-10-23T16:40:00Z")] });
    const checks = await verifySeries(withFinal);
    const final = checks.filter((c) => c.label.startsWith("Final call"));
    expect(final.map((c) => [c.label, c.ok])).toEqual([
      ["Final call: fingerprint matches", true],
      ["Final call: locked before the game", true],
      ["Final call: top-ups match the published calls", true],
      ["Final call: every top-up is on the analyst's own side", true],
    ]);
  });
  it("fails a final call committed under another market id or after the start", async () => {
    chain({ c: [committed("x", analystBatch, "2026-10-23T09:00:00Z")], f: [committed("x", finalBatch, "2026-10-23T17:02:00Z")] });
    const checks = await verifySeries(withFinal);
    expect(checks.find((c) => c.label === "Final call: fingerprint matches")!.ok).toBe(false);
    expect(checks.find((c) => c.label === "Final call: locked before the game")!.ok).toBe(false);
  });
  it("fails a top-up on the other side, or one that isn't in the published calls", async () => {
    const flipped = canonicalBatch("x:final", [{ player: "analyst-top", market: "winner", choice: "IG", stake: 600 }]);
    chain({ c: [committed("x", analystBatch, "2026-10-23T09:00:00Z")], f: [committed("x:final", flipped, "2026-10-23T16:40:00Z")] });
    const checks = await verifySeries({ ...withFinal, finalBatch: flipped });
    expect(checks.find((c) => c.label === "Final call: every top-up is on the analyst's own side")!.ok).toBe(false);
    const edited = await verifySeries({ ...withFinal, finalCalls: [{ player: "analyst-top", add: 700, side: "GEN" }] });
    expect(edited.find((c) => c.label === "Final call: top-ups match the published calls")!.ok).toBe(false);
  });
  it("adds nothing for a record without a final call (old records verify as before)", async () => {
    chain({ c: [committed("x", analystBatch, "2026-10-23T09:00:00Z")] });
    const checks = await verifySeries(base);
    expect(checks.map((c) => c.label)).toEqual(["Analysts' picks: fingerprint matches", "Analysts' picks: locked before the game", "Result on Sui"]);
    expect(checks.slice(0, 2).every((c) => c.ok)).toBe(true);
  });
});

describe("verifySeries: void", () => {
  it("accepts a VOID result and says every stake was refunded", async () => {
    chain({ c: [committed("x", analystBatch, "2026-10-23T09:00:00Z")], r: [posted("VOID", "VOID")] });
    const result = (await verifySeries({ ...base, result: { winner: "VOID", score: "VOID", resultDigest: "r" } })).find((c) => c.label === "Result on Sui")!;
    expect(result.ok).toBe(true);
    expect(result.detail).toMatch(/void.*refunded/i);
  });
  it("judges commits against the start stored at commit", async () => {
    chain({ c: [committed("x", analystBatch, "2026-10-23T17:01:00Z")] });
    const checks = await verifySeries(base);
    expect(checks.find((c) => c.label === "Analysts' picks: locked before the game")!.ok).toBe(false);
  });
});
