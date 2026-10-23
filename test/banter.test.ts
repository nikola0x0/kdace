import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBanterPrompt, needsBanter, parseBanter } from "../src/core/banter.ts";
import { Store, type SeriesRecord } from "../src/core/store.ts";
import { runBanter } from "../src/jobs/banter.ts";

const pick = (role: string, winner: string) => ({ player: `analyst-${role}`, winner, score: null, winProbability: 60, reasoning: `${role} reasons`, usedLessons: [], pickedAt: "2026-10-23T08:00:00Z", stake: 100 });
const rec = (winners: string[], over: Partial<SeriesRecord> = {}): SeriesRecord => ({
  series: { matchId: "g2dk", startTime: "2026-10-23T21:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "G2", teamB: "DK", winsA: 0, winsB: 0, winner: null },
  status: "committed", picks: ["top", "jungle", "mid", "adc", "support"].map((r, i) => pick(r, winners[i])),
  batch: "{}", batchHash: "h", commitDigest: "d", result: null, axp: null, debate: null, lessons: [], ...over,
});
const now = new Date("2026-10-23T09:00:00Z");
const reply = JSON.stringify({ comments: [
  { by: "top", replyTo: null, text: "DK? Lumi, no..." },
  { by: "support", replyTo: 0, text: "Kairo, trust the vibes." },
  { by: "mid", replyTo: 7, text: "Reply to nothing becomes a top-level comment." },
  { by: "nobody", replyTo: null, text: "dropped" },
  { by: "adc", replyTo: null, text: "x".repeat(300) },
] });

describe("banter", () => {
  it("only threads committed splits that don't have one yet", () => {
    expect(needsBanter(rec(["G2", "G2", "G2", "G2", "DK"]))).toBe(true);
    expect(needsBanter(rec(["G2", "G2", "G2", "G2", "G2"]))).toBe(false);
    expect(needsBanter(rec(["G2", "DK", "G2", "G2", "G2"], { status: "settled" }))).toBe(false);
    expect(needsBanter(rec(["G2", "DK", "G2", "G2", "G2"], { banter: { comments: [], at: "x" } }))).toBe(false);
  });
  it("tells the writer to keep Lumi safe and lists every pick with its reasoning", () => {
    const p = buildBanterPrompt(rec(["G2", "G2", "G2", "G2", "DK"]));
    expect(p).toContain("Nobody ever roasts Lumi");
    expect(p).toContain("Lumi (support");
    expect(p).toContain('picked DK at 60%. Their reasoning: "support reasons"');
  });
  it("keeps valid comments from analysts who picked, fixes bad reply links, drops the rest", () => {
    const b = parseBanter(reply, rec(["G2", "G2", "G2", "G2", "DK"]), now);
    expect(b.comments).toEqual([
      { by: "top", replyTo: null, text: "DK? Lumi, no..." },
      { by: "support", replyTo: 0, text: "Kairo, trust the vibes." },
      { by: "mid", replyTo: null, text: "Reply to nothing becomes a top-level comment." },
    ]);
    expect(() => parseBanter('{"comments":[]}', rec(["G2", "DK", "G2", "G2", "G2"]), now)).toThrow();
  });
  it("writes threads for open splits before lock, and skips failures", async () => {
    const store = new Store(mkdtempSync(join(tmpdir(), "kdace-")));
    store.put(rec(["G2", "G2", "G2", "G2", "DK"]));
    store.put(rec(["A", "B", "A", "A", "A"], { series: { ...rec([]).series, matchId: "late", startTime: "2026-10-23T09:02:00Z" } }));
    const done = await runBanter({ store, ask: async () => reply, now: () => now, log: () => {} });
    expect(done).toEqual(["g2dk"]);
    expect(store.get("g2dk")!.banter!.comments).toHaveLength(3);
    expect(store.get("late")!.banter).toBeUndefined();
  });
});
