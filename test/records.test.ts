import { describe, expect, it } from "vitest";
import { boardMatches } from "../src/core/checks.ts";
import { recordsFromUrl } from "../src/core/records.ts";
import type { SeriesRecord } from "../src/core/store.ts";

const record: SeriesRecord = {
  series: { matchId: "x", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "GEN", teamB: "IG", winsA: 0, winsB: 0, winner: null },
  status: "committed", picks: [], batch: "b", batchHash: "h", commitDigest: "d", result: null, axp: null, debate: null, lessons: [],
};
const serve = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("recordsFromUrl", () => {
  it("reads the public records endpoint into a store verify can check", async () => {
    const st = await recordsFromUrl("https://kdace.xyz/api/records", serve(200, { generatedAt: "t", series: [record], board: [], titleDays: [] }));
    expect(st.get("x")).toEqual(record);
    expect(st.titleDays()).toEqual([]);
    expect(boardMatches(st)).toBe(true);
  });
  it("refuses an error status or a body without the three lists", async () => {
    await expect(recordsFromUrl("u", serve(503, { error: "down" }))).rejects.toThrow(/HTTP 503/);
    await expect(recordsFromUrl("u", serve(200, { series: [] }))).rejects.toThrow(/series, board and titleDays/);
  });
});
