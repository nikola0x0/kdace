import { describe, expect, it } from "vitest";
import { decideDispatch, githubDispatcher, pendingRecords, runDispatch, type DispatchDeps, type PendingRecord } from "../src/core/dispatch.ts";
import type { SeriesRecord } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";
import { MemoryFanDb } from "./helpers/memory-fandb.ts";

const START = "2026-10-23T17:00:00Z";
const series: Series = { matchId: "x", startTime: START, block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const done: Series = { ...series, state: "completed", winsA: 1, winsB: 0, winner: "GEN" };
const pending: PendingRecord = { matchId: "x", startTime: START, finalCallOpen: false };
const at = (minsFromStart: number) => new Date(Date.parse(START) + minsFromStart * 60_000);
const decide = (p: PendingRecord[], schedule: Series[] | null, now: Date, lastDispatchAt: string | null = null, tickActive = false) => decideDispatch({ pending: p, schedule, now, lastDispatchAt, tickActive });

describe("decideDispatch", () => {
  it("dispatches when a committed series is now completed with a winner", () => {
    expect(decide([pending], [done], at(60))).toMatchObject({ dispatch: true, reasons: ["x: result is in"] });
  });
  it("does not dispatch for a completed series without a winner, or one still running", () => {
    expect(decide([pending], [{ ...done, winner: null }], at(60)).dispatch).toBe(false);
    expect(decide([pending], [{ ...series, state: "inProgress" }], at(60)).dispatch).toBe(false);
  });
  it("dispatches for a missing final call within 20 minutes of lock, until 3 minutes before it", () => {
    const open = { ...pending, finalCallOpen: true };
    expect(decide([open], [series], at(-26)).dispatch).toBe(false);
    expect(decide([open], [series], at(-25))).toMatchObject({ dispatch: true, reasons: ["x: final call due"] });
    expect(decide([open], [series], at(-9)).dispatch).toBe(true);
    expect(decide([open], [series], at(-8)).dispatch).toBe(false);
    expect(decide([pending], [series], at(-20)).dispatch).toBe(false);
  });
  it("uses the official start when it moved earlier", () => {
    expect(decide([{ ...pending, finalCallOpen: true }], [{ ...series, startTime: "2026-10-23T16:30:00Z" }], at(-40)).dispatch).toBe(true);
  });
  it("still dispatches a final call when the schedule is unavailable, judging by the stored start", () => {
    expect(decide([{ ...pending, finalCallOpen: true }], null, at(-20)).dispatch).toBe(true);
    expect(decide([pending], null, at(60)).dispatch).toBe(false);
  });
  it("never dispatches more than once per 4 minutes", () => {
    expect(decide([pending], [done], at(60), at(57).toISOString())).toMatchObject({ dispatch: false });
    expect(decide([pending], [done], at(60), at(56).toISOString()).dispatch).toBe(true);
  });
  it("does not dispatch while a tick is already running or queued", () => {
    expect(decide([pending], [done], at(60), null, true).dispatch).toBe(false);
  });
  it("does nothing when there's nothing to do", () => {
    expect(decide([], [done], at(60))).toEqual({ dispatch: false, reasons: [] });
  });
  it("stops chasing a result 12 hours after the start (a settle that keeps failing waits for the regular ticks)", () => {
    expect(decide([pending], [done], at(13 * 60)).dispatch).toBe(false);
  });
});

describe("pendingRecords", () => {
  const rec = (patch: Partial<SeriesRecord>): SeriesRecord => ({ series, status: "committed", picks: [{ player: "analyst-top" } as SeriesRecord["picks"][number]], batch: "b", batchHash: "h", commitDigest: "d", result: null, axp: null, debate: null, lessons: [], chain: { network: "mainnet", packageId: "0xp" }, ...patch });
  const chain = { network: "mainnet" as const, packageId: "0xp" };
  it("lists records awaiting a result, flagging those still owed a final call", () => {
    expect(pendingRecords([rec({})], chain)).toEqual([{ matchId: "x", startTime: START, finalCallOpen: true }]);
    expect(pendingRecords([rec({ finalCall: { status: "none", batch: null, batchHash: null, commitDigest: null, calls: [] } })], chain)[0].finalCallOpen).toBe(false);
  });
  it("leaves out finished records and records committed on another network", () => {
    expect(pendingRecords([rec({ status: "settled" }), rec({ status: "void" }), rec({ status: "missed" })], chain)).toEqual([]);
    expect(pendingRecords([rec({ chain: { network: "testnet", packageId: "0xold" } })], chain)).toEqual([]);
  });
});

function fakes(overrides: Partial<DispatchDeps> = {}) {
  const triggered: string[] = [];
  const db = new MemoryFanDb();
  const deps: DispatchDeps = {
    db,
    loadPending: async () => [pending],
    fetchSeries: async () => [done],
    tickActive: async () => false,
    trigger: async () => void triggered.push("tick"),
    now: () => at(60),
    log: () => {},
    ...overrides,
  };
  return { deps, db, triggered };
}

describe("runDispatch", () => {
  it("triggers the tick and stores the dispatch time durably", async () => {
    const { deps, db, triggered } = fakes();
    expect(await runDispatch(deps)).toMatchObject({ dispatched: true });
    expect(triggered).toEqual(["tick"]);
    expect(await db.lastDispatchAt()).toBe(at(60).toISOString());
  });
  it("debounces across runs (one per 4 minutes)", async () => {
    const { deps, triggered } = fakes();
    await runDispatch(deps);
    await runDispatch({ ...deps, now: () => at(63) });
    expect(triggered).toHaveLength(1);
    await runDispatch({ ...deps, now: () => at(64) });
    expect(triggered).toHaveLength(2);
  });
  it("only one of two overlapping runs claims the slot", async () => {
    const { deps, triggered } = fakes();
    await Promise.all([runDispatch(deps), runDispatch(deps)]);
    expect(triggered).toHaveLength(1);
  });
  it("does nothing when nothing is pending, and doesn't ask GitHub whether a tick runs", async () => {
    let asked = 0;
    const { deps, triggered } = fakes({ loadPending: async () => [], tickActive: async () => (asked++, false) });
    expect(await runDispatch(deps)).toEqual({ dispatched: false, reasons: [] });
    expect(triggered).toEqual([]);
    expect(asked).toBe(0);
  });
  it("judges final calls by stored start when lolesports is down", async () => {
    const { deps, triggered } = fakes({ fetchSeries: async () => { throw new Error("down"); }, loadPending: async () => [{ ...pending, finalCallOpen: true }], now: () => at(-20) });
    await runDispatch(deps);
    expect(triggered).toEqual(["tick"]);
  });
});

describe("githubDispatcher", () => {
  type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
  const fake = (respond: (c: Call) => { status?: number; json?: unknown; text?: string }) => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const c = { url: String(url), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(c);
      const { status = 200, json, text } = respond(c);
      return new Response(text ?? (json === undefined ? null : JSON.stringify(json)), { status });
    }) as typeof fetch;
    return { calls, fetchImpl };
  };
  it("dispatches tick.yml on main with the token", async () => {
    const { calls, fetchImpl } = fake(() => ({ status: 204 }));
    await githubDispatcher("ghp_x", fetchImpl).trigger();
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.github.com/repos/nikola0x0/kdace/actions/workflows/tick.yml/dispatches", body: { ref: "main" } });
    expect(calls[0].headers.Authorization).toBe("Bearer ghp_x");
  });
  it("throws when GitHub refuses the dispatch", async () => {
    const { fetchImpl } = fake(() => ({ status: 403, text: "nope" }));
    await expect(githubDispatcher("t", fetchImpl).trigger()).rejects.toThrow(/403/);
  });
  it("reads data/pending.json from main (empty before the first tick writes it)", async () => {
    const { calls, fetchImpl } = fake(() => ({ json: [pending] }));
    expect(await githubDispatcher("t", fetchImpl).loadPending()).toEqual([pending]);
    expect(calls[0].url).toBe("https://api.github.com/repos/nikola0x0/kdace/contents/data/pending.json?ref=main");
    expect(calls[0].headers.Accept).toBe("application/vnd.github.raw+json");
    expect(await githubDispatcher("t", fake(() => ({ status: 404, text: "{}" })).fetchImpl).loadPending()).toEqual([]);
  });
  it("sees a tick that is queued or running", async () => {
    const running = fake((c) => ({ json: { total_count: c.url.includes("status=in_progress") ? 1 : 0 } }));
    expect(await githubDispatcher("t", running.fetchImpl).tickActive()).toBe(true);
    const idle = fake(() => ({ json: { total_count: 0 } }));
    expect(await githubDispatcher("t", idle.fetchImpl).tickActive()).toBe(false);
    expect(idle.calls.map((c) => c.url)).toEqual([
      "https://api.github.com/repos/nikola0x0/kdace/actions/workflows/tick.yml/runs?status=queued&per_page=1",
      "https://api.github.com/repos/nikola0x0/kdace/actions/workflows/tick.yml/runs?status=in_progress&per_page=1",
    ]);
  });
});
