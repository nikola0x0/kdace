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
    remember: async (role, text) => (remembered.push(`${role}:${text}`), `blob-${remembered.length}`),
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
  it("resumes after a crash without duplicating", async () => {
    let calls = 0;
    const first = fakes({ remember: async () => { if (++calls === 3) throw new Error("relayer down"); return `blob-${calls}`; } });
    await expect(runSettle(first.deps)).rejects.toThrow("relayer down");
    const again = { ...first.deps, remember: async (_r: string, _t: string) => `blob-${++calls}` };
    await runSettle(again);
    const r = first.store.get("x")!;
    expect(r.lessons).toHaveLength(5);
    expect(new Set(r.lessons.map((l) => l.player)).size).toBe(5);
    expect(first.posted).toHaveLength(1);
  });
  it("ignores series not yet completed", async () => {
    const { deps, posted } = fakes({ fetchSeries: async () => [series] });
    await runSettle(deps);
    expect(posted).toEqual([]);
  });
});
