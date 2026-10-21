import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store, type SeriesRecord } from "../src/core/store.ts";

const record = (matchId: string): SeriesRecord => ({
  series: { matchId, startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null },
  status: "committed", picks: [], batch: "b", batchHash: "h", commitDigest: "d", result: null, points: null, debate: null, lessons: [],
});

describe("Store", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "kdace-"));
  it("round-trips a record", () => {
    const st = new Store(dir());
    st.put(record("x"));
    expect(st.get("x")).toEqual(record("x"));
    expect(st.get("missing")).toBeNull();
  });
  it("lists all records", () => {
    const st = new Store(dir());
    st.put(record("x"));
    st.put(record("y"));
    expect(st.all().map((r) => r.series.matchId).sort()).toEqual(["x", "y"]);
  });
  it("round-trips the board", () => {
    const st = new Store(dir());
    expect(st.readBoard()).toEqual([]);
    st.writeBoard([{ player: "analyst-adc", points: 500, k: 1, d: 0, a: 1 }]);
    expect(st.readBoard()).toEqual([{ player: "analyst-adc", points: 500, k: 1, d: 0, a: 1 }]);
  });
});
