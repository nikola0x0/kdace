import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSTS } from "../src/core/analysts.ts";
import { batchHash } from "../src/core/batch.ts";
import { Store } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";
import { runPick, type PickDeps } from "../src/jobs/pick.ts";

const series: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 3, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const before = new Date("2026-10-23T12:00:00Z");
const after = new Date("2026-10-23T17:30:00Z");
const good = JSON.stringify({ winner: "GEN", score: "2-1", winProbability: 61, reasoning: "r", usedLessonIds: [] });

function fakes(overrides: Partial<PickDeps> = {}) {
  const commits: string[] = [];
  const deps: PickDeps = {
    fetchSeries: async () => [series],
    store: new Store(mkdtempSync(join(tmpdir(), "kdace-"))),
    recall: async () => [],
    ask: async () => good,
    commit: async (matchId) => (commits.push(matchId), "digest-1"),
    history: () => [],
    now: () => before,
    log: () => {},
    ...overrides,
  };
  return { deps, commits };
}

describe("runPick", () => {
  it("commits one batch for a series with 5 valid picks", async () => {
    const { deps, commits } = fakes();
    await runPick(deps);
    const r = deps.store.get("x")!;
    expect(commits).toEqual(["x"]);
    expect(r.status).toBe("committed");
    expect(r.picks).toHaveLength(5);
    expect(r.batchHash).toBe(batchHash(r.batch!));
    expect(JSON.parse(r.batch!).entries).toHaveLength(10);
  });
  it("skips an analyst after two bad replies and still commits with 4", async () => {
    const { deps } = fakes({ ask: async (p) => (p.includes(ANALYSTS[0].belief) ? "no json" : good) });
    await runPick(deps);
    expect(deps.store.get("x")!.picks.map((p) => p.player)).not.toContain("analyst-top");
    expect(deps.store.get("x")!.picks).toHaveLength(4);
  });
  it("does not commit when fewer than 3 analysts are valid", async () => {
    let n = 0;
    const { deps, commits } = fakes({ ask: async () => (n++ < 6 ? "garbage" : good) });
    await runPick(deps);
    expect(commits).toEqual([]);
    expect(deps.store.get("x")).toBeNull();
  });
  it("writes missed instead of committing if the series started during picking", async () => {
    let calls = 0;
    const { deps, commits } = fakes({ now: () => (calls++ === 0 ? before : after) });
    await runPick(deps);
    expect(commits).toEqual([]);
    expect(deps.store.get("x")!.status).toBe("missed");
  });
  it("is idempotent", async () => {
    const { deps, commits } = fakes();
    await runPick(deps);
    await runPick(deps);
    expect(commits).toEqual(["x"]);
  });
});
