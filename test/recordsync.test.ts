import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareRecords, copyRecords } from "../src/core/recordsync.ts";
import { MemoryStore, Store, type SeriesRecord } from "../src/core/store.ts";
import { SupabaseRest, SupabaseStore } from "../src/core/supastore.ts";
import { FakePostgrest } from "./helpers/fake-postgrest.ts";

const record = (matchId: string, over: Partial<SeriesRecord> = {}): SeriesRecord => ({
  series: { matchId, startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null },
  status: "committed", picks: [], batch: `{"matchId":"${matchId}","entries":[]}`, batchHash: "h", commitDigest: "d", result: null, axp: null, debate: null, lessons: [], chain: { network: "mainnet", packageId: "0xpkg" },
  ...over,
});

function fileData() {
  const dir = mkdtempSync(join(tmpdir(), "kdace-"));
  const st = new Store(dir);
  st.put(record("a"));
  st.put(record("b", { status: "settled", result: { winner: "GEN", score: "1-0", resultDigest: "r" }, axp: { "analyst-top": 100 } }));
  st.putTitleDay({ date: "2026-10-23", status: "committed", picks: [], batch: "b", batchHash: "h", commitDigest: "d" });
  st.writeBoard([{ player: "analyst-top", balance: 10100, net: 100, k: 1, d: 0, a: 1, bets: 1 }]);
  st.writeFanNames({ ["0x" + "a".repeat(64)]: "alice.sui" });
  st.writeScout({ series: [{ matchId: "s1" }], games: [{ gameId: "g1" }], teams: { GEN: { code: "GEN" } }, meta: { generatedAt: "t" } });
  return { dir, st };
}
const supabase = () => {
  const pg = new FakePostgrest();
  return { pg, st: () => new SupabaseStore(new SupabaseRest("https://p.supabase.co", "k", pg.fetch, { sleep: async () => {} })) };
};
const writes = (pg: FakePostgrest) => pg.calls.filter((c) => c.method !== "GET").length;

describe("copyRecords / compareRecords", () => {
  it("copies data/ into Supabase, after which both compare identical (byte-exact)", async () => {
    const { st: file } = fileData();
    const { st } = supabase();
    const out = await copyRecords(file, st());
    expect(out.series).toEqual({ inserted: 2, updated: 0, same: 0, extra: [] });
    expect(out.titleDays).toEqual({ inserted: 1, updated: 0, same: 0, extra: [] });
    expect(out.docs).toEqual({ written: ["board", "fan_names"], same: [] });
    expect(out.scout).toEqual({ written: ["series", "games", "teams", "meta"], same: [] });
    const cmp = await compareRecords(file, st());
    expect(cmp).toEqual({ identical: true, byteExact: true, differences: [] });
  });

  it("is idempotent: a second copy writes nothing", async () => {
    const { st: file } = fileData();
    const { pg, st } = supabase();
    await copyRecords(file, st());
    const before = writes(pg);
    const again = await copyRecords(file, st());
    expect(writes(pg)).toBe(before);
    expect(again.series).toEqual({ inserted: 0, updated: 0, same: 2, extra: [] });
    expect(again.docs.written).toEqual([]);
    expect(again.scout.written).toEqual([]);
  });

  it("updates only what changed, and never deletes a record missing from the source (reports it)", async () => {
    const { st: file } = fileData();
    const { st } = supabase();
    await copyRecords(file, st());
    await st().put(record("z"));
    file.put(record("a", { status: "settled" }));
    const out = await copyRecords(file, st());
    expect(out.series).toEqual({ inserted: 0, updated: 1, same: 1, extra: ["z"] });
    expect((await st().get("z"))!.status).toBe("committed");
  });

  it("dry run counts without writing", async () => {
    const { st: file } = fileData();
    const { pg, st } = supabase();
    const out = await copyRecords(file, st(), { dryRun: true });
    expect(out.series.inserted).toBe(2);
    expect(writes(pg)).toBe(0);
  });

  it("reports every difference: missing, extra, changed content, and key order only", async () => {
    const { st: file } = fileData();
    const other = new MemoryStore();
    for (const r of file.all()) other.put(r);
    other.put(record("extra"));
    other.series.delete("a");
    const b = file.get("b")!;
    other.put({ ...b, debate: "changed" });
    const cmp = await compareRecords(file, other);
    expect(cmp.identical).toBe(false);
    expect(cmp.differences).toEqual(expect.arrayContaining(["series a: missing in target", "series extra: only in target", "series b: content differs", "title day 2026-10-23: missing in target", "board: content differs", "fan names: content differs"]));
    const original = new MemoryStore();
    original.put(record("a"));
    const reordered = new MemoryStore();
    const { series, ...rest } = record("a");
    reordered.put({ ...rest, series } as SeriesRecord);
    const onlyOrder = await compareRecords(original, reordered);
    expect(onlyOrder).toEqual({ identical: true, byteExact: false, differences: ["series a: same content, different key order"] });
  });

  it("round-trips the repo's real data/ (every live record) byte-for-byte", async () => {
    const live = new Store("data");
    const { st } = supabase();
    await copyRecords(live, st());
    expect(await compareRecords(live, st())).toEqual({ identical: true, byteExact: true, differences: [] });
    const outDir = mkdtempSync(join(tmpdir(), "kdace-live-"));
    await copyRecords(st(), new Store(outDir));
    for (const f of readdirSync("data/series").filter((x) => x.endsWith(".json"))) expect(readFileSync(join(outDir, "series", f), "utf8")).toBe(readFileSync(join("data/series", f), "utf8"));
  });

  it("exports Supabase back to files byte-identical to the originals (the daily snapshot)", async () => {
    const { dir, st: file } = fileData();
    const { st } = supabase();
    await copyRecords(file, st());
    const outDir = mkdtempSync(join(tmpdir(), "kdace-export-"));
    await copyRecords(st(), new Store(outDir));
    for (const sub of ["series", "titles", "scout"]) for (const f of readdirSync(join(dir, sub))) expect(readFileSync(join(outDir, sub, f), "utf8")).toBe(readFileSync(join(dir, sub, f), "utf8"));
    for (const f of ["board.json", "fans.json"]) expect(readFileSync(join(outDir, f), "utf8")).toBe(readFileSync(join(dir, f), "utf8"));
  });
});
