import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seriesToPick, seriesToSettle } from "../src/core/select.ts";
import { Store } from "../src/core/store.ts";
import type { Series } from "../src/core/worlds.ts";

const base: Series = { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null };
const store = () => new Store(mkdtempSync(join(tmpdir(), "kdace-")));
const before = new Date("2026-10-23T12:00:00Z");
const after = new Date("2026-10-23T17:30:00Z");
const committed = { series: base, status: "committed" as const, picks: [], batch: "b", batchHash: "h", commitDigest: "d", result: null, points: null, debate: null, lessons: [] };

describe("selection", () => {
  it("picks unstarted series with known teams before start", () => {
    expect(seriesToPick([base], store(), before).pick.map((s) => s.matchId)).toEqual(["x"]);
  });
  it("skips TBD teams entirely", () => {
    const r = seriesToPick([{ ...base, teamA: "TBD", teamB: "TBD" }], store(), before);
    expect(r).toEqual({ pick: [], missed: [] });
  });
  it("never re-picks a series that already has a record", () => {
    const st = store();
    st.put(committed);
    expect(seriesToPick([base], st, before).pick).toEqual([]);
  });
  it("marks a started series without a record as missed", () => {
    expect(seriesToPick([base], store(), after)).toEqual({ pick: [], missed: [base] });
  });
  it("settles only completed series that were committed", () => {
    const st = store();
    const done = { ...base, state: "completed" as const, winner: "GEN", winsA: 1, winsB: 0 };
    st.put(committed);
    expect(seriesToSettle([done], st).map((s) => s.matchId)).toEqual(["x"]);
    st.put({ ...st.get("x")!, status: "settled" });
    expect(seriesToSettle([done], st)).toEqual([]);
  });
});
