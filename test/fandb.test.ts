import { describe, expect, it } from "vitest";
import { fanDbFromEnv, SupabaseFanDb, withRefereeLock } from "../src/core/fandb.ts";
import { MemoryFanDb } from "./helpers/memory-fandb.ts";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

function fakeFetch(respond: (c: Call) => { status?: number; json?: unknown } = () => ({ json: [] })) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    const c: Call = { method: init?.method ?? "GET", url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const { status = 200, json } = respond(c);
    return new Response(json === undefined ? null : JSON.stringify(json), { status });
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

const URL_ = "https://proj.supabase.co";
const A = "0x" + "a".repeat(64);

describe("SupabaseFanDb", () => {
  it("upserts a pick on (match_id, address, market) so the last pick wins", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ status: 201 }));
    await new SupabaseFanDb(URL_, "sb_secret_x", fetchImpl).upsertPick({ matchId: "m", address: A, market: "winner", choice: "GEN", updatedAt: "2026-10-23T12:00:00.000Z" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe(`${URL_}/rest/v1/picks?on_conflict=match_id,address,market`);
    expect(calls[0].headers.Prefer).toContain("resolution=merge-duplicates");
    expect(calls[0].body).toEqual({ match_id: "m", address: A, market: "winner", choice: "GEN", updated_at: "2026-10-23T12:00:00.000Z" });
  });

  it("sends the key as apikey, and as a Bearer token only when it is a JWT", async () => {
    const a = fakeFetch();
    await new SupabaseFanDb(URL_, "sb_secret_x", a.fetchImpl).ping();
    expect(a.calls[0].headers.apikey).toBe("sb_secret_x");
    expect(a.calls[0].headers.Authorization).toBeUndefined();
    const b = fakeFetch();
    await new SupabaseFanDb(URL_, "eyJhbGciOi.jwt.sig", b.fetchImpl).ping();
    expect(b.calls[0].headers.Authorization).toBe("Bearer eyJhbGciOi.jwt.sig");
  });

  it("maps snake_case rows and filters picks by match ids", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ json: [{ match_id: "m", address: A, market: "score", choice: "2-1", updated_at: "2026-10-23T12:00:00+00:00" }] }));
    const rows = await new SupabaseFanDb(URL_, "k", fetchImpl).picksFor(["m", "n"]);
    expect(decodeURIComponent(calls[0].url)).toBe(`${URL_}/rest/v1/picks?select=*&match_id=in.("m","n")`);
    expect(rows).toEqual([{ matchId: "m", address: A, market: "score", choice: "2-1", updatedAt: "2026-10-23T12:00:00+00:00" }]);
    expect(await new SupabaseFanDb(URL_, "k", fetchImpl).picksFor([])).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("reports a commit row that already exists as not inserted", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 409, json: { code: "23505" } }));
    const row = { matchId: "m", status: "committing" as const, batch: "{}", batchHash: "h", pickCount: 1, commitDigest: null, network: "testnet", packageId: "0x1", committedAt: null, attemptedAt: "t" };
    expect(await new SupabaseFanDb(URL_, "k", fetchImpl).insertCommit(row)).toBe(false);
  });

  it("updates a commit only if nobody else touched it since", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ json: [] }));
    const ok = await new SupabaseFanDb(URL_, "k", fetchImpl).updateCommit("m", { status: "committed", commitDigest: "d" }, "2026-10-23T16:55:20.000+00:00");
    expect(ok).toBe(false);
    expect(calls[0].method).toBe("PATCH");
    expect(decodeURIComponent(calls[0].url)).toBe(`${URL_}/rest/v1/fan_commits?match_id=eq.m&attempted_at=eq.2026-10-23T16:55:20.000+00:00`);
    expect(calls[0].body).toEqual({ status: "committed", commit_digest: "d" });
  });

  it("throws on server errors so callers don't mistake them for empty results", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500, json: { message: "down" } }));
    await expect(new SupabaseFanDb(URL_, "k", fetchImpl).listCommits()).rejects.toThrow(/500/);
  });

  it("reads cached SuiNS names for a set of fans", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ json: [{ address: A, suins_name: "nikola.sui" }] }));
    expect(await new SupabaseFanDb(URL_, "k", fetchImpl).fanNames([A])).toEqual({ [A]: "nikola.sui" });
    expect(decodeURIComponent(calls[0].url)).toBe(`${URL_}/rest/v1/fans?select=address,suins_name&address=in.("${A}")`);
  });

  it("takes the referee lock through an RPC", async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({ json: true }));
    expect(await new SupabaseFanDb(URL_, "k", fetchImpl).acquireRefereeLock("tick", 120)).toBe(true);
    expect(calls[0].url).toBe(`${URL_}/rest/v1/rpc/acquire_referee_lock`);
    expect(calls[0].body).toEqual({ p_holder: "tick", p_ttl_seconds: 120 });
  });
});

describe("fanDbFromEnv", () => {
  it("is null until Supabase is configured", () => {
    expect(fanDbFromEnv({})).toBeNull();
    expect(fanDbFromEnv({ SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: "k" })).toBeInstanceOf(SupabaseFanDb);
  });
});

describe("withRefereeLock", () => {
  it("waits for the other holder, runs, then releases", async () => {
    const db = new MemoryFanDb();
    await db.acquireRefereeLock("tick", 120);
    let slept = 0;
    const run = withRefereeLock(db, "fan-lock", async () => "done", { waitMs: 10_000, sleep: async () => { if (++slept === 2) await db.releaseRefereeLock("tick"); } });
    expect(await run).toBe("done");
    expect(slept).toBe(2);
    expect(db.lockHolder).toBeNull();
  });
  it("gives up when the lock stays taken", async () => {
    const db = new MemoryFanDb();
    await db.acquireRefereeLock("tick", 120);
    let ran = false;
    await expect(withRefereeLock(db, "fan-lock", async () => { ran = true; }, { waitMs: 0, sleep: async () => {} })).rejects.toThrow(/busy/);
    expect(ran).toBe(false);
  });
  it("runs anyway when asked to and the database is unreachable (the lock route can't commit then either)", async () => {
    const db = new MemoryFanDb();
    db.acquireRefereeLock = async () => { throw new Error("fetch failed"); };
    expect(await withRefereeLock(db, "tick", async () => "ran", { proceedIfDbDown: true })).toBe("ran");
    await expect(withRefereeLock(db, "fan-lock", async () => "ran")).rejects.toThrow("fetch failed");
  });
  it("releases even when the job throws, and runs directly without a database", async () => {
    const db = new MemoryFanDb();
    await expect(withRefereeLock(db, "x", async () => { throw new Error("chain down"); })).rejects.toThrow("chain down");
    expect(db.lockHolder).toBeNull();
    expect(await withRefereeLock(null, "x", async () => 7)).toBe(7);
  });
});
