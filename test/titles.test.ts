import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSTS } from "../src/core/analysts.ts";
import { batchHash, canonicalBatch } from "../src/core/batch.ts";
import { checkTitleDay } from "../src/core/checks.ts";
import { Store } from "../src/core/store.ts";
import { aliveTeams, parseTitlePick, titleHistory, tournamentOver } from "../src/core/titles.ts";
import type { Series } from "../src/core/worlds.ts";
import { runTitles, type TitleDeps } from "../src/jobs/titles.ts";

const s = (o: Partial<Series>): Series => ({ matchId: "m", startTime: "2026-10-23T17:00:00Z", block: "Swiss", bestOf: 1, state: "unstarted", teamA: "A", teamB: "B", winsA: 0, winsB: 0, winner: null, ...o });
const won = (teamA: string, teamB: string, winner: string, block = "Swiss") => s({ teamA, teamB, winner, block, state: "completed" });

describe("aliveTeams", () => {
  it("drops Play-In teams once the main stage is scheduled, Swiss teams on 3 losses, and knockout losers", () => {
    const series = [
      won("PI1", "PI2", "PI1", "Play-In"),
      won("GEN", "T1", "GEN"), won("GEN", "T1", "GEN"), won("GEN", "T1", "GEN"),
      won("BLG", "G2", "BLG", "Quarterfinals"),
      s({ teamA: "GEN", teamB: "BLG", block: "Semifinals" }),
      s({ teamA: "TBD", teamB: "TBD", block: "Final" }),
    ];
    expect(aliveTeams(series)).toEqual(["BLG", "GEN"]);
  });
  it("uses every team before the main stage exists", () => expect(aliveTeams([s({ teamA: "X", teamB: "Y", block: "Play-In" })])).toEqual(["X", "Y"]));
  it("knows when the final is done", () => expect(tournamentOver([won("GEN", "BLG", "GEN", "Final")])).toBe(true));
});

describe("parseTitlePick", () => {
  const now = new Date("2026-10-23T08:00:00Z");
  it("accepts a team still alive, rounds the probability, cleans contenders", () => {
    const p = parseTitlePick('{"champion":"GEN","probability":31.6,"contenders":["GEN","BLG","XXX","HLE","T1"],"reasoning":"r"}', ANALYSTS[0], ["GEN", "BLG", "HLE", "T1"], now);
    expect(p).toMatchObject({ player: "analyst-top", champion: "GEN", probability: 32, contenders: ["BLG", "HLE"] });
  });
  it("rejects eliminated teams and impossible probabilities", () => {
    expect(() => parseTitlePick('{"champion":"T1","probability":30}', ANALYSTS[0], ["GEN"], now)).toThrow();
    expect(() => parseTitlePick('{"champion":"GEN","probability":0}', ANALYSTS[0], ["GEN"], now)).toThrow();
  });
});

function fakes(over: Partial<TitleDeps> = {}) {
  const commits: string[] = [];
  const deps: TitleDeps = {
    fetchSeries: async () => [s({ teamA: "GEN", teamB: "BLG" })],
    store: new Store(mkdtempSync(join(tmpdir(), "kdace-"))),
    ask: async () => '{"champion":"GEN","probability":30,"contenders":["BLG"],"reasoning":"r"}',
    commit: async (id) => (commits.push(id), "digest-t"),
    chain: { network: "testnet", packageId: "0xpkg" },
    teams: () => ({}),
    history: () => [],
    now: () => new Date("2026-10-23T08:00:00Z"),
    log: () => {},
    ...over,
  };
  return { deps, commits };
}

describe("runTitles", () => {
  it("commits one fingerprinted batch per day and never re-picks that day", async () => {
    const { deps, commits } = fakes();
    expect((await runTitles(deps)).status).toBe("committed");
    const day = deps.store.getTitleDay("2026-10-23")!;
    expect(commits).toEqual(["title:2026-10-23"]);
    expect(day.picks).toHaveLength(5);
    expect(day.batchHash).toBe(batchHash(canonicalBatch("title:2026-10-23", day.picks.map((p) => ({ player: p.player, market: "title", choice: "GEN", stake: 0 })))));
    expect(day.chain).toEqual({ network: "testnet", packageId: "0xpkg" });
    expect((await runTitles(deps)).status).toBe("already picked");
    expect(commits).toHaveLength(1);
    expect(titleHistory(deps.store.titleDays())["analyst-mid"]).toEqual([{ date: "2026-10-23", champion: "GEN", probability: 30 }]);
  });
  it("re-submits the recorded hash after a failed commit instead of asking again", async () => {
    let asks = 0;
    const { deps, commits } = fakes({ ask: async () => (asks++, '{"champion":"GEN","probability":30}'), commit: async () => { throw new Error("rpc down"); } });
    await expect(runTitles(deps)).rejects.toThrow("rpc down");
    const recorded = deps.store.getTitleDay("2026-10-23")!;
    expect(recorded.status).toBe("committing");
    deps.commit = async (id) => (commits.push(id), "digest-2");
    expect((await runTitles(deps)).status).toBe("committed");
    expect(asks).toBe(5);
    expect(deps.store.getTitleDay("2026-10-23")!.batchHash).toBe(recorded.batchHash);
  });
  it("needs at least 3 valid analysts, and stops after the final", async () => {
    let n = 0;
    expect((await runTitles(fakes({ ask: async () => (n++ < 6 ? "nope" : '{"champion":"GEN","probability":30}') }).deps)).status).toMatch(/only 2 valid/);
    expect((await runTitles(fakes({ fetchSeries: async () => [won("GEN", "BLG", "GEN", "Final")] }).deps)).status).toBe("tournament over");
  });
});

describe("checkTitleDay", () => {
  it("passes for the committed batch on its day, fails for a rewritten call or a late commit", async () => {
    const { deps } = fakes();
    await runTitles(deps);
    const day = deps.store.getTitleDay("2026-10-23")!;
    const ev = (hash: string, at: string) => ({ type: "BatchCommitted" as const, json: { market_id: "title:2026-10-23", batch_hash: Buffer.from(hash, "hex").toString("base64"), committed_at_ms: String(Date.parse(at)) } });
    expect(Object.values(checkTitleDay(day, ev(day.batchHash, "2026-10-23T08:01:00Z"))).every(Boolean)).toBe(true);
    expect(checkTitleDay(day, ev(day.batchHash, "2026-10-24T00:01:00Z")).titleCommittedThatDay).toBe(false);
    const rewritten = { ...day, picks: day.picks.map((p, i) => (i ? p : { ...p, champion: "BLG" })) };
    expect(checkTitleDay(rewritten, ev(day.batchHash, "2026-10-23T08:01:00Z")).titleEntriesMatchCalls).toBe(false);
  });
});
