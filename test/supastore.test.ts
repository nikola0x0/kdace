import { describe, expect, it } from "vitest";
import { Store, type SeriesRecord } from "../src/core/store.ts";
import { recordsLiveInSupabase, StoreConflictError, SupabaseRest, SupabaseRunnerDb, SupabaseStore, storeFromEnv, storeKind } from "../src/core/supastore.ts";
import type { TitleDay } from "../src/core/titles.ts";
import { FakePostgrest } from "./helpers/fake-postgrest.ts";

const URL_ = "https://proj.supabase.co";
const record = (matchId: string, status: SeriesRecord["status"] = "committing"): SeriesRecord => ({
  series: { matchId, startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null },
  status, picks: [], batch: '{"matchId":"x","entries":[]}', batchHash: "h", commitDigest: null, result: null, axp: null, debate: null, lessons: [],
});
const day = (date: string, status: TitleDay["status"] = "committing"): TitleDay => ({ date, status, picks: [], batch: "b", batchHash: "h", commitDigest: null });

const setup = () => {
  const pg = new FakePostgrest();
  const rest = new SupabaseRest(URL_, "sb_secret_x", pg.fetch, { sleep: async () => {} });
  return { pg, rest, store: () => new SupabaseStore(rest) };
};

describe("SupabaseStore", () => {
  it("round-trips series records, keeping the stored JSON exactly as written", async () => {
    const { pg, store } = setup();
    const st = store();
    expect(await st.get("x")).toBeNull();
    await st.put(record("x"));
    await st.put({ ...record("x"), status: "committed", commitDigest: "d" });
    const fresh = store();
    expect(await fresh.get("x")).toEqual({ ...record("x"), status: "committed", commitDigest: "d" });
    expect(JSON.stringify(pg.tables.series_records[0].record)).toBe(JSON.stringify({ ...record("x"), status: "committed", commitDigest: "d" }));
    expect(pg.tables.series_records[0].version).toBe(2);
    expect((await fresh.all()).map((r) => r.series.matchId)).toEqual(["x"]);
  });

  it("refuses to overwrite a record another invocation changed since it was read (compare-and-set on version)", async () => {
    const { store } = setup();
    const a = store(), b = store();
    await a.put(record("x"));
    await b.get("x");
    await a.put({ ...record("x"), status: "committed", commitDigest: "d1" });
    await expect(b.put({ ...record("x"), status: "missed" })).rejects.toBeInstanceOf(StoreConflictError);
    expect((await store().get("x"))!.commitDigest).toBe("d1");
  });

  it("refuses to create a record that already exists when it never read it", async () => {
    const { store } = setup();
    await store().put(record("x", "committed"));
    await expect(store().put(record("x"))).rejects.toBeInstanceOf(StoreConflictError);
    expect((await store().get("x"))!.status).toBe("committed");
  });

  it("retries a network error or a 5xx, and treats a write whose response was lost as done when it landed", async () => {
    const { pg, store } = setup();
    const st = store();
    pg.faults = ["network", "503"];
    await st.put(record("x"));
    pg.faults = ["lost-response"];
    await st.put({ ...record("x"), status: "committed", commitDigest: "d" });
    pg.faults = ["lost-response"];
    await st.put({ ...record("x"), status: "settled", commitDigest: "d" });
    expect((await store().get("x"))!.status).toBe("settled");
    expect(pg.tables.series_records[0].version).toBe(3);
  });

  it("fails fast once Supabase stays down, without writing anything", async () => {
    const { pg, store } = setup();
    pg.faults = ["network", "network", "network", "network"];
    await expect(store().put(record("x"))).rejects.toThrow(/fetch failed/);
    expect(pg.tables.series_records).toEqual([]);
  });

  it("stores title days with the same compare-and-set, oldest first", async () => {
    const { store } = setup();
    const st = store();
    await st.putTitleDay(day("2026-10-24"));
    await st.putTitleDay(day("2026-10-23"));
    await st.putTitleDay({ ...day("2026-10-24"), status: "committed", commitDigest: "d" });
    expect((await store().titleDays()).map((d) => [d.date, d.status])).toEqual([["2026-10-23", "committing"], ["2026-10-24", "committed"]]);
    expect((await store().getTitleDay("2026-10-24"))!.commitDigest).toBe("d");
    expect(await store().getTitleDay("2026-10-25")).toBeNull();
  });

  it("keeps the board, fan names and pending list as single documents", async () => {
    const { store } = setup();
    const st = store();
    expect(await st.readBoard()).toEqual([]);
    expect(await st.readFanNames()).toEqual({});
    await st.writeBoard([{ player: "analyst-adc", balance: 10500, net: 500, k: 1, d: 0, a: 1, bets: 1 }]);
    await st.writeBoard([{ player: "analyst-adc", balance: 10600, net: 600, k: 1, d: 0, a: 1, bets: 1 }]);
    await st.writeFanNames({ "0xa": "alice.sui" });
    await st.writePending([{ matchId: "x" }]);
    expect((await store().readBoard())[0].balance).toBe(10600);
    expect(await store().readFanNames()).toEqual({ "0xa": "alice.sui" });
  });

  it("stores Scout data by file key and reads it back only when series, games and teams exist", async () => {
    const { store } = setup();
    const st = store();
    expect(await st.readScout()).toBeNull();
    await st.writeScout({ series: [{ matchId: "s" }], games: [] });
    expect(await st.readScout()).toBeNull();
    await st.writeScout({ teams: { GEN: {} }, meta: { generatedAt: "t" } });
    expect(await store().readScout()).toEqual({ series: [{ matchId: "s" }], games: [], teams: { GEN: {} } });
    expect(await store().readScoutFile("meta")).toEqual({ generatedAt: "t" });
  });

  it("reads a snapshot for the site: records, board, title days and fan names", async () => {
    const { store } = setup();
    const st = store();
    await st.put(record("x"));
    await st.putTitleDay(day("2026-10-23"));
    await st.writeBoard([]);
    await st.writeFanNames({ "0xa": null });
    const snap = await store().snapshot();
    expect(snap.series.map((r) => r.series.matchId)).toEqual(["x"]);
    expect(snap.titleDays.map((d) => d.date)).toEqual(["2026-10-23"]);
    expect(snap.fanNames).toEqual({ "0xa": null });
  });

  it("sends the key as apikey, and as a bearer token only for legacy JWT keys", async () => {
    const { pg } = setup();
    const seen: Record<string, string>[] = [];
    const spy = (async (u: string, init?: RequestInit) => (seen.push(init!.headers as Record<string, string>), pg.fetch(u, init))) as typeof fetch;
    await new SupabaseStore(new SupabaseRest(URL_, "sb_secret_x", spy)).get("x");
    await new SupabaseStore(new SupabaseRest(URL_, "eyJhbGciOi", spy)).get("x");
    expect(seen[0].apikey).toBe("sb_secret_x");
    expect(seen[0].Authorization).toBeUndefined();
    expect(seen[1].Authorization).toBe("Bearer eyJhbGciOi");
  });
});

describe("SupabaseRunnerDb", () => {
  it("lets one holder take the runner lock at a time, until it releases or the lock expires", async () => {
    const { pg, rest } = setup();
    let now = 1_000_000;
    pg.now = () => now;
    const db = new SupabaseRunnerDb(rest);
    expect(await db.acquireRunnerLock("a", 300)).toBe(true);
    expect(await db.acquireRunnerLock("b", 300)).toBe(false);
    await db.releaseRunnerLock("b"); // not the holder: no effect
    expect(await db.acquireRunnerLock("b", 300)).toBe(false);
    await db.releaseRunnerLock("a");
    expect(await db.acquireRunnerLock("b", 300)).toBe(true);
    now += 301_000;
    expect(await db.acquireRunnerLock("c", 300)).toBe(true);
  });

  it("stores each stage's next and last run", async () => {
    const { rest } = setup();
    const db = new SupabaseRunnerDb(rest);
    expect(await db.readState()).toEqual({});
    await db.writeState("scout", { nextAt: "2026-10-24T10:30:00.000Z", lastAt: "2026-10-24T10:00:00.000Z", note: "complete" });
    await db.writeState("scout", { nextAt: "2026-10-24T11:00:00.000Z", lastAt: "2026-10-24T10:30:00.000Z", note: "complete" });
    expect(await db.readState()).toEqual({ scout: { nextAt: "2026-10-24T11:00:00.000Z", lastAt: "2026-10-24T10:30:00.000Z", note: "complete" } });
  });
});

describe("recordsLiveInSupabase", () => {
  const env = { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: "k" };
  it("is false before the copy (no table, empty table, no config, Supabase down) and true after", async () => {
    const pg = new FakePostgrest();
    expect(await recordsLiveInSupabase({}, pg.fetch)).toBe(false);
    expect(await recordsLiveInSupabase(env, pg.fetch)).toBe(false);
    const missing = (async () => new Response(JSON.stringify({ code: "PGRST205" }), { status: 404 })) as unknown as typeof fetch;
    expect(await recordsLiveInSupabase(env, missing)).toBe(false);
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await recordsLiveInSupabase(env, down)).toBe(false);
    pg.tables.series_records.push({ match_id: "x", record: {}, version: 1 });
    expect(await recordsLiveInSupabase(env, pg.fetch)).toBe(true);
  });
});

describe("storeFromEnv", () => {
  it("defaults to the file store, so nothing changes until KDACE_STORE=supabase", () => {
    expect(storeKind({})).toBe("file");
    expect(storeKind({ KDACE_STORE: "file" })).toBe("file");
    expect(storeFromEnv({})).toBeInstanceOf(Store);
  });
  it("uses Supabase when asked, and refuses to start without its settings or with an unknown value", () => {
    expect(storeFromEnv({ KDACE_STORE: "supabase", SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: "k" })).toBeInstanceOf(SupabaseStore);
    expect(() => storeFromEnv({ KDACE_STORE: "supabase" })).toThrow(/SUPABASE_URL/);
    expect(() => storeKind({ KDACE_STORE: "supabse" })).toThrow(/KDACE_STORE/);
  });
});
