import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSTS } from "../src/core/analysts.ts";
import { canonicalBatch } from "../src/core/batch.ts";
import { Store, type SeriesRecord } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";
import { runSettle, type SettleDeps } from "../src/jobs/settle.ts";

const series: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const done: Series = { ...series, state: "completed", winsA: 1, winsB: 0, winner: "GEN" };
const picks = ANALYSTS.map((a, i) => ({ player: a.player, winner: i < 2 ? "GEN" : "IG", score: null, winProbability: 60, reasoning: "r", usedLessons: [], pickedAt: "2026-10-23T12:00:00Z" }));
const committed = (): SeriesRecord => ({
  series, status: "committed", picks, batchHash: "h", commitDigest: "d", result: null, points: null, debate: null, lessons: [],
  batch: canonicalBatch("x", picks.map((p) => ({ player: p.player, market: "winner" as const, choice: p.winner }))),
});

function fakes(overrides: Partial<SettleDeps> = {}) {
  const posted: string[][] = [];
  const remembered: string[] = [];
  const store = new Store(mkdtempSync(join(tmpdir(), "kdace-")));
  store.put(committed());
  const deps: SettleDeps = {
    fetchSeries: async () => [done],
    store,
    postResult: async (m, w, s) => (posted.push([m, w, s]), "result-digest"),
    ask: async (p) => (p.includes("debate") && p.includes("Write the debate") ? "Top: ...\nJungle: ...\nMid: ...\nADC: ...\nSupport: ..." : "ADC lesson: something."),
    startRemember: async (role, text) => (remembered.push(`${role}:${text}`), `job-${remembered.length}`),
    awaitRemember: async (_role, jobId) => jobId.replace("job", "blob"),
    log: () => {},
    ...overrides,
  };
  return { deps, posted, remembered, store };
}

describe("runSettle", () => {
  it("posts result, scores, debates and writes one lesson per analyst", async () => {
    const { deps, posted, remembered, store } = fakes();
    await runSettle(deps);
    const r = store.get("x")!;
    expect(posted).toEqual([["x", "GEN", "1-0"]]);
    expect(remembered).toHaveLength(5);
    expect(r.status).toBe("settled");
    expect(r.points).toEqual({ "analyst-top": 500, "analyst-jungle": 500 });
    expect(r.debate).toContain("Support:");
    expect(store.readBoard().reduce((sum, row) => sum + row.points, 0)).toBe(1000);
  });
  it("resumes a timed-out lesson by waiting on the same job instead of writing it again", async () => {
    let waits = 0;
    const first = fakes({ awaitRemember: async (_r, jobId) => { if (++waits === 3) throw new Error("timed out"); return jobId.replace("job", "blob"); } });
    await runSettle(first.deps);
    expect(first.store.get("x")!.status).toBe("committed");
    const awaited: string[] = [];
    await runSettle({ ...first.deps, awaitRemember: async (_r, jobId) => (awaited.push(jobId), jobId.replace("job", "blob")) });
    const r = first.store.get("x")!;
    expect(first.remembered).toHaveLength(5);
    expect(awaited).toEqual(["job-3", "job-4", "job-5"]);
    expect(r.lessons.every((l) => l.blobId.startsWith("blob-"))).toBe(true);
    expect(r.status).toBe("settled");
    expect(first.posted).toHaveLength(1);
  });
  it.each([
    ["no winner yet", { winner: null, winsA: 0, winsB: 0 }],
    ["an unfinished score", { winner: "GEN", winsA: 1, winsB: 1, bestOf: 3 as const }],
    ["a winner outside the match", { winner: "T1", winsA: 1, winsB: 0 }],
  ])("does not settle a completed series with %s", async (_n, patch) => {
    const { deps, posted, store } = fakes({ fetchSeries: async () => [{ ...done, ...patch }] });
    await runSettle(deps);
    expect(posted).toEqual([]);
    expect(store.get("x")!.status).toBe("committed");
  });
  it("keeps settling other series when one fails", async () => {
    const { deps, store } = fakes();
    store.put({ ...committed(), series: { ...series, matchId: "y" } });
    await runSettle({ ...deps, fetchSeries: async () => [done, { ...done, matchId: "y" }], postResult: async (m) => { if (m === "x") throw new Error("boom"); return "rd"; } });
    expect(store.get("y")!.status).toBe("settled");
    expect(store.get("x")!.status).toBe("committed");
  });
  it("ignores series not yet completed", async () => {
    const { deps, posted } = fakes({ fetchSeries: async () => [series] });
    await runSettle(deps);
    expect(posted).toEqual([]);
  });
});
