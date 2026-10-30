import { describe, expect, it } from "vitest";
import { buildEulogyPrompt, knockedOut, needsEulogy, parseEulogy } from "../src/core/graveyard.ts";
import { MemoryStore, type SeriesRecord } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";
import { runGraveyard } from "../src/jobs/graveyard.ts";

const ROLES = ["top", "jungle", "mid", "adc", "support"];
const s = (matchId: string, teamA: string, teamB: string, winner: string | null, day: number, block = "Swiss"): Series => ({
  matchId, startTime: `2026-10-${String(day).padStart(2, "0")}T18:00:00Z`, block, bestOf: 1, state: winner ? "completed" : "unstarted", teamA, teamB, winsA: winner === teamA ? 1 : 0, winsB: winner === teamB ? 1 : 0, winner,
});
const settled = (x: Series, picked: string, over: Partial<SeriesRecord> = {}): SeriesRecord => ({
  series: x, status: "settled",
  picks: ROLES.map((r) => ({ player: `analyst-${r}`, winner: picked, score: null, winProbability: 60, reasoning: "r", usedLessons: [], pickedAt: "t", stake: 100 })),
  batch: "{}", batchHash: "h", commitDigest: "d", result: { winner: x.winner!, score: "1-0", resultDigest: "r" }, axp: {}, debate: "debate",
  lessons: ROLES.map((r) => ({ player: `analyst-${r}`, text: `${r} lesson on ${x.teamA}-${x.teamB} (from the debate)`, blobId: `blob-${r}-${x.matchId}` })), ...over,
});

// TSW loses three Swiss series; DK loses a quarterfinal; a Play-In loser is ignored.
const schedule = [
  s("p1", "FUR", "C9", "C9", 15, "Play-Ins"),
  s("a", "TSW", "LYON", "LYON", 24), s("b", "TSW", "IG", "IG", 24), s("c", "LOS", "TSW", "LOS", 26),
  s("q", "DK", "GEN", "GEN", 31, "Quarterfinals"), s("next", "T1", "HLE", null, 31),
];
const records = [settled(schedule[1], "LYON"), settled(schedule[2], "IG"), settled(schedule[3], "TSW"), settled(schedule[4], "GEN")];
const now = new Date("2026-10-31T00:00:00Z");

describe("graveyard", () => {
  it("finds main-stage teams on a third Swiss loss or a knockout loss, not Play-In exits", () => {
    expect(knockedOut(schedule)).toEqual([
      { team: "TSW", out: { matchId: "c", by: "LOS", block: "Swiss", at: schedule[3].startTime }, record: { w: 0, l: 3 } },
      { team: "DK", out: { matchId: "q", by: "GEN", block: "Quarterfinals", at: schedule[4].startTime }, record: { w: 0, l: 1 } },
    ]);
  });
  it("waits for the lessons on the knockout series, and skips teams that already have a thread", () => {
    const pending = records.map((r) => (r.series.matchId === "c" ? { ...r, lessons: r.lessons.slice(0, 3) } : r));
    expect(needsEulogy(schedule, pending, {}).map((k) => k.team)).toEqual(["DK"]);
    expect(needsEulogy(schedule, records, { DK: {} as never }).map((k) => k.team)).toEqual(["TSW"]);
  });
  it("hands each analyst their own calls and labelled lessons on the team, and keeps Lumi safe", () => {
    const p = buildEulogyPrompt(knockedOut(schedule)[0], records);
    expect(p).toContain("TSW is out of Worlds 2026: 0-3 in the main stage, eliminated by LOS (Swiss)");
    expect(p).toContain("10-26 LOS vs TSW (LOS won 1-0): picked TSW at 60%, WRONG");
    expect(p).toContain("[L3] adc lesson on LOS-TSW");
    expect(p).not.toContain("(from the debate)");
    expect(p).toContain("Nobody ever roasts Lumi");
  });
  it("links each roast to the lesson it cites, one comment per analyst", () => {
    const k = knockedOut(schedule)[0];
    const reply = JSON.stringify({ comments: [
      { by: "adc", replyTo: null, lesson: "L1", text: "1-6 abroad. I wrote it down. Then bet on them anyway." },
      { by: "adc", replyTo: null, lesson: null, text: "second comment from Raze is dropped" },
      { by: "top", replyTo: 0, lesson: "L9", text: "Unknown lesson ids become null." },
      { by: "support", replyTo: 5, lesson: "l3", text: "Bye TSW, you tried 💛" },
    ] });
    const e = parseEulogy(reply, k, records, now);
    expect(e.comments).toEqual([
      { by: "adc", replyTo: null, text: "1-6 abroad. I wrote it down. Then bet on them anyway.", lesson: { blobId: "blob-adc-a", text: "adc lesson on TSW-LYON" } },
      { by: "top", replyTo: 0, text: "Unknown lesson ids become null.", lesson: null },
      { by: "support", replyTo: null, text: "Bye TSW, you tried 💛", lesson: { blobId: "blob-support-c", text: "support lesson on LOS-TSW" } },
    ]);
    expect(() => parseEulogy('{"comments":[]}', k, records, now)).toThrow();
  });
  it("writes one thread per run and keeps the ones already written", async () => {
    const store = new MemoryStore();
    for (const r of records) store.put(r);
    const reply = JSON.stringify({ comments: ["top", "mid", "support"].map((by) => ({ by, replyTo: null, lesson: "L1", text: `${by} roast` })) });
    const deps = { store, fetchSeries: async () => schedule, ask: async () => reply, now: () => now, log: () => {} };
    expect(await runGraveyard(deps)).toEqual(["TSW"]);
    expect(await runGraveyard(deps)).toEqual(["DK"]);
    expect(await runGraveyard(deps)).toEqual([]);
    expect(Object.keys(store.readGraveyard())).toEqual(["TSW", "DK"]);
  });
});
