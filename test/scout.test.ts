import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Frame,
  type GameSummary,
  type SeriesResult,
  aggregateTeam,
  buildTeams,
  champ,
  densifyTimes,
  digestFor,
  firstTo,
  floor10,
  headToHead,
  mergeFrames,
  moments,
  nextProbe,
  parseDetails,
  parseEvent,
  parseLeagueSeries,
  parseWindow,
  reconcileWinners,
  sampleGames,
  sampleTimes,
  summarizeGame,
  usableEnd,
} from "../src/core/scout.ts";

const fx = (name: string) => JSON.parse(readFileSync(`test/fixtures/scout/${name}`, "utf8"));

// Real KC vs C9, Worlds 2026 Play-Ins, game 1 (C9 on red won), trimmed to a few frames.
const first = parseWindow(fx("window-first.json"));
const ten = parseWindow(fx("window-10m.json"));
const fifteen = parseWindow(fx("window-15m.json"));
const end = parseWindow(fx("window-end.json"));
const details = parseDetails(fx("details-end.json"));
const event = parseEvent(fx("event-details.json"));
const frames = mergeFrames(first.frames, ten.frames, fifteen.frames, end.frames);

describe("feed parsing", () => {
  it("reads game metadata from the window feed", () => {
    expect(first.meta).toMatchObject({ gameId: "115660588583171787", matchId: "115660588583171786", patch: "16.20" });
    expect(first.meta!.blue.teamId).toBe("111692118851466302");
    expect(first.meta!.blue.players.find((p) => p.role === "top")).toMatchObject({ name: "KC Canna", champion: "Rumble" });
    expect(first.meta!.red.players.find((p) => p.role === "bottom")).toMatchObject({ champion: "Ezreal" });
  });
  it("reads team totals per frame", () => {
    expect(fifteen.frames[0]).toMatchObject({ ts: "2026-10-15T18:31:30.390Z", blue: { gold: 24405, kills: 0, dragons: ["cloud"] }, red: { gold: 26081, kills: 3 } });
    expect(end.frames.at(-1)!.state).toBe("finished");
    expect(end.frames.at(-1)!.players!.find((p) => p.participantId === 8)).toMatchObject({ kills: 11, deaths: 0, assists: 3 });
  });
  it("reads per-player damage share from the details feed", () => {
    expect(details.find((p) => p.participantId === 9)!.damageShare).toBeCloseTo(0.41, 2);
  });
  it("reads games, sides and team codes from event details", () => {
    expect(event.teams).toEqual([{ id: "111692118851466302", code: "KC" }, { id: "98767991877340524", code: "C9" }]);
    expect(event.games[0]).toEqual({ id: "115660588583171787", number: 1, state: "completed", blueId: "111692118851466302", redId: "98767991877340524" });
  });
  it("merges windows in time order without duplicates", () => {
    expect(mergeFrames(end.frames, end.frames).length).toBe(end.frames.length);
    expect(frames[0].ts < frames.at(-1)!.ts).toBe(true);
  });
});

describe("timing helpers", () => {
  it("rounds down to 10 seconds in RFC3339", () => {
    expect(floor10(Date.parse("2026-10-15T18:31:39.922Z"))).toBe("2026-10-15T18:31:30Z");
  });
  it("samples every minute of game time between start and end", () => {
    const times = sampleTimes("2026-10-15T18:16:34.661Z", "2026-10-15T18:20:00.000Z", 60);
    expect(times).toEqual(["2026-10-15T18:17:30Z", "2026-10-15T18:18:30Z", "2026-10-15T18:19:30Z"]);
  });
  it("always includes the 10/15/20/25-minute checkpoints with coarser sampling", () => {
    const times = sampleTimes("2026-10-15T18:00:00.000Z", "2026-10-15T18:17:00.000Z", 120);
    expect(times).toContain("2026-10-15T18:15:00Z");
    expect(times).toContain("2026-10-15T18:10:00Z");
    expect(times).toContain("2026-10-15T18:16:00Z");
    expect(times).not.toContain("2026-10-15T18:20:00Z");
    expect(times).toEqual([...times].sort());
  });
});

const tf = (gold: number, kills = 0, towers = 0, dragons: string[] = [], barons = 0, inhibitors = 0) => ({ gold, kills, towers, dragons, barons, inhibitors });
const f = (sec: number, blue: ReturnType<typeof tf>, red: ReturnType<typeof tf>, state = "in_game"): Frame => ({
  ts: new Date(Date.parse("2026-01-01T00:00:00Z") + sec * 1000).toISOString(),
  state,
  blue,
  red,
});

describe("first objectives", () => {
  it("credits the only team that has it at the first frame anyone does", () => {
    expect(firstTo(frames, "kills")).toBe("red");
    expect(firstTo(frames, "dragons")).toBe("red");
  });
  it("is unresolved when both teams have it at the first frame and asks for a probe in between", () => {
    expect(firstTo(frames, "towers")).toBeNull();
    const probe = nextProbe(frames, ["towers"])!;
    expect(probe > "2026-10-15T18:31:39Z" && probe < "2026-10-15T18:51:37Z").toBe(true);
  });
  it("stops probing once the gap is inside one 10-second window", () => {
    const fs = [f(0, tf(2500), tf(2500)), f(100, tf(3000), tf(3000)), f(105, tf(3000, 1), tf(3000, 1))];
    expect(firstTo(fs, "kills")).toBeNull();
    expect(nextProbe(fs, ["kills"])).toBeNull();
  });
});

// A synthetic game: blue falls 4.2k behind at 20:00, steals baron at 24:00 and wins.
function comebackFrames(): Frame[] {
  const out: Frame[] = [];
  const diffs = [0, 0, 100, 300, 500, -200, -400, -600, -900, -1200, -1500, -1800, -2100, -2400, -2700, -3000, -3300, -3600, -3900, -4000, -4200, -3800, -3000, -2500, -1000, 1000, 2500, 4000, 6000];
  diffs.forEach((d, m) => {
    const base = 2500 + m * 2000;
    const blueBaron = m >= 24 ? 1 : 0;
    const redDragons = m >= 7 ? ["infernal"] : [];
    const blueDragons = m >= 13 ? ["ocean"] : [];
    out.push(f(m * 60 + 2, tf(base + d / 2, m >= 3 ? 1 : 0, m >= 26 ? 5 : m >= 12 ? 1 : 0, blueDragons, blueBaron, m >= 27 ? 1 : 0), tf(base - d / 2, m >= 4 ? 2 : 0, m >= 9 ? 2 : 0, redDragons), m === diffs.length - 1 ? "finished" : "in_game"));
  });
  return out;
}

function summary(): GameSummary {
  return summarizeGame(summaryInput());
}
function summaryInput() {
  const cb = comebackFrames();
  return ({
    meta: { ...first.meta!, gameId: "g1", matchId: "m1", blue: { ...first.meta!.blue, teamId: "A" }, red: { ...first.meta!.red, teamId: "B" } },
    frames: cb,
    details: [],
    teams: { A: "BLG", B: "TES" },
    league: "Worlds 2026",
    number: 1,
    winnerHint: null,
  });
}

// Player-level frames for fun facts. Participants 1-5 blue (KC), 6-10 red (C9), as in the real fixture's metadata.
type P = { k?: number; d?: number; a?: number };
function pf(sec: number, blue: ReturnType<typeof tf>, red: ReturnType<typeof tf>, ps: Record<number, P> = {}, state = "in_game"): Frame {
  return {
    ...f(sec, blue, red, state),
    players: Array.from({ length: 10 }, (_, i) => ({ participantId: i + 1, kills: ps[i + 1]?.k ?? 0, deaths: ps[i + 1]?.d ?? 0, assists: ps[i + 1]?.a ?? 0, gold: 0, cs: 0 })),
  };
}
const kcC9 = { "111692118851466302": "KC", "98767991877340524": "C9" };

describe("fun facts", () => {
  const frames = [
    pf(0, tf(2500), tf(2500)),
    pf(60, tf(2600), tf(2600)),
    pf(95, tf(3000, 1), tf(2700), { 3: { k: 1 }, 8: { d: 1 } }),
    pf(600, tf(16000, 1), tf(15000), { 3: { k: 1 }, 8: { d: 1 } }),
    pf(1200, tf(36000, 2, 3), tf(30000), { 3: { k: 1 }, 8: { d: 1 } }),
    pf(1210, tf(37000, 3, 3), tf(30000), { 3: { k: 2 }, 8: { d: 2 } }),
    pf(1220, tf(38000, 4, 3), tf(30000), { 3: { k: 4 }, 8: { d: 3 } }),
    pf(1230, tf(39000, 5, 3), tf(30000), { 3: { k: 5 }, 8: { d: 4 } }),
    pf(1400, tf(45000, 9, 9), tf(31000, 1, 1), { 3: { k: 5 }, 5: { k: 2, a: 9 }, 7: { k: 0, d: 9, a: 1 }, 8: { d: 4 } }, "finished"),
  ];
  const details = [
    { participantId: 9, kills: 0, deaths: 0, assists: 0, damageShare: 0.2, killParticipation: null, cs: 100, wards: 10 },
    { participantId: 10, kills: 0, deaths: 0, assists: 0, damageShare: 0.05, killParticipation: null, cs: 20, wards: 90 },
    { participantId: 4, kills: 0, deaths: 0, assists: 0, damageShare: 0.45, killParticipation: null, cs: 250, wards: 10 },
  ];
  const s = summarizeGame({ meta: first.meta!, frames, details: [], teams: kcC9, league: "LCK 2026", number: 1, winnerHint: null });
  const texts = summarizeGame({ meta: first.meta!, frames, details, teams: kcC9, league: "LCK 2026", number: 1, winnerHint: null }).funFacts.map((x) => x.text);
  it("spots likely multi-kills only inside a 30-second span", () => {
    expect(texts).toContain("Likely quadra kill: KC kyeahoo (Syndra) at 20:30");
  });
  it("spots rough patches, rough days and deathless games", () => {
    expect(texts).toContain("C9 Loki (Locke) died 3 times between 20:00 and 20:30");
    expect(texts).toContain("C9 Blaber (Xin Zhao) finished 0/9/1");
    expect(texts).toContain("KC Busio (Nautilus) went 2/0/9 without dying");
  });
  it("spots an early first blood and a stomp", () => {
    expect(texts).toContain("First blood before 1:35 (KC)");
    expect(texts).toContain("KC won in 23:20");
  });
  it("spots odd details-feed stats", () => {
    expect(texts).toContain("C9 Tactical (Ezreal) had 100 CS in 23 min");
    expect(texts).toContain("C9 Vulcan (Karma) placed 90 wards");
    expect(texts).toContain("KC Caliste (Miss Fortune) dealt 45% of KC's champion damage");
    expect(s.funFacts.some((x) => x.kind === "cs")).toBe(false);
  });
  it("spots a peaceful early game, a marathon, a 10k comeback and an elder that flipped it", () => {
    const fs: Frame[] = [];
    for (let m = 0; m <= 41; m++) {
      const d = m < 30 ? -m * 400 : -12000 + (m - 30) * 2500; // red leads by 12k at 30:00, blue comes back
      fs.push(pf(m * 60, tf(2500 + m * 2000 + d / 2, m >= 11 ? 5 : 0, m >= 40 ? 9 : 2, m >= 33 ? ["elder"] : []), tf(2500 + m * 2000 - d / 2, m >= 11 ? 5 : 0, m >= 20 ? 8 : 1), {}, m === 41 ? "finished" : "in_game"));
    }
    const t = summarizeGame({ meta: first.meta!, frames: fs, details: [], teams: kcC9, league: "LCK 2026", number: 1, winnerHint: null }).funFacts.map((x) => x.text);
    expect(t).toContain("No kills before 10:00");
    expect(t).toContain("Marathon: 41:00");
    expect(t).toContain("KC came back from 12.0k down");
    expect(t).toContain("KC took Elder at 33:00 while 7.0k down and won");
  });
});

describe("fun facts: objectives while behind", () => {
  it("only counts a dragon from 4k+ down and a Baron from 3k+ down", () => {
    const fs = [
      pf(0, tf(2500), tf(2500)),
      pf(600, tf(15000), tf(17500)),
      pf(660, tf(15500, 0, 0, ["infernal"]), tf(18000)), // 2.5k down: not a fact
      pf(1200, tf(30000, 0, 0, ["infernal"]), tf(34500)),
      pf(1260, tf(31000, 0, 0, ["infernal", "ocean"]), tf(35000)), // 4.5k down
      pf(1500, tf(40000, 0, 0, ["infernal", "ocean"]), tf(43000)),
      pf(1560, tf(41000, 0, 0, ["infernal", "ocean"], 1), tf(43000), {}), // 3k down
      pf(1800, tf(50000, 0, 1), tf(48000, 0, 5), {}, "finished"),
    ];
    const t = summarizeGame({ meta: first.meta!, frames: fs, details: [], teams: kcC9, league: "LCK 2026", number: 1, winnerHint: null }).funFacts.map((x) => x.text);
    expect(t.filter((x) => x.includes("took"))).toEqual(["KC took an ocean dragon at 21:00 while 4.5k down", "KC took Baron at 26:00 while 3.0k down"]);
  });
});

describe("densifyTimes", () => {
  it("fills the gap where a player's kills jumped by 3+ with 10-second windows", () => {
    const fs = [pf(0, tf(0), tf(0)), pf(60, tf(0), tf(0)), pf(120, tf(0, 3), tf(0), { 2: { k: 3 } })];
    expect(densifyTimes(fs)).toEqual(["2026-01-01T00:01:10Z", "2026-01-01T00:01:20Z", "2026-01-01T00:01:30Z", "2026-01-01T00:01:40Z", "2026-01-01T00:01:50Z"]);
    expect(densifyTimes(fs.slice(0, 2))).toEqual([]);
  });
});

describe("summarizeGame (real fixture)", () => {
  const s = summarizeGame({ meta: first.meta!, frames, details, teams: { "111692118851466302": "KC", "98767991877340524": "C9" }, league: "Worlds 2026", number: 1, winnerHint: null });
  it("names sides, winner, gold at 15 and duration", () => {
    expect(s.blue.code).toBe("KC");
    expect(s.red.code).toBe("C9");
    expect(s.winner).toBe("C9");
    expect(s.blue.gold15).toBe(24405);
    expect(s.red.gold15).toBe(26081);
    expect(s.durationMin).toBeCloseTo(35.1, 1);
    expect(s.date).toBe("2026-10-15T18:16:34.661Z");
  });
  it("keeps champions by role and final objectives", () => {
    expect(s.blue.champions).toEqual({ top: "Rumble", jungle: "LeeSin", mid: "Syndra", bottom: "MissFortune", support: "Nautilus" });
    expect(s.red).toMatchObject({ towers: 11, barons: 2, inhibitors: 2, dragons: ["chemtech", "infernal", "infernal", "infernal"], firstBlood: true, firstDragon: true, firstTower: null });
    expect(s.blue).toMatchObject({ firstBlood: false, firstDragon: false });
  });
  it("lists every player with KDA and damage share, and picks a standout", () => {
    expect(s.players).toHaveLength(10);
    expect(s.players.find((p) => p.name === "C9 Loki")).toMatchObject({ code: "C9", champion: "Locke", role: "mid", k: 11, d: 0, a: 3 });
    expect(s.standout).toMatchObject({ code: "C9", name: "C9 Loki" });
  });
});

describe("summarizeGame (gold story)", () => {
  const s = summary();
  it("tracks the gold difference per minute and leads at checkpoints", () => {
    expect(s.goldDiff[20]).toBe(-4200);
    const sparse = summarizeGame({ ...summaryInput(), frames: comebackFrames().filter((_, m) => m % 2 === 0 || m === 15 || m === 25 || m === 28) });
    expect(sparse.goldDiff[3]).toBeNull();
    expect(sparse.leads[15]).toBe(-3000);
    expect(s.leads).toEqual({ 10: -1500, 15: -3000, 20: -4200, 25: 1000 });
    expect(s.maxLead).toEqual({ blue: { gold: 6000, min: 28 }, red: { gold: 4200, min: 20 } });
  });
  it("finds the comeback and the biggest swing within 5 minutes", () => {
    expect(s.winner).toBe("BLG");
    expect(s.comeback).toEqual({ team: "BLG", deficit: 4200, min: 20 });
    expect(s.swing).toEqual({ team: "BLG", gold: 8500, fromMin: 23, toMin: 28 });
  });
  it("builds a key-moments timeline with objective-while-behind flags", () => {
    const types = s.events.map((e) => `${e.min}:${e.type}:${e.team}`);
    expect(types).toContain("3:firstBlood:BLG");
    expect(types).toContain("7:dragon:TES");
    expect(types).toContain("9:firstTower:TES");
    expect(types).toContain("24:baron:BLG");
    expect(types).toContain("27:inhibitor:BLG");
    expect(s.events.at(-1)).toMatchObject({ type: "end", team: "BLG" });
    expect(s.events.find((e) => e.type === "baron")!.behind).toBe(2500);
    expect(s.events.find((e) => e.type === "dragon" && e.team === "BLG")).toMatchObject({ detail: "ocean", behind: 2100 });
    expect(s.blue.firstBaronMin).toBe(24);
  });
});

const sr = (date: string, league: string, block: string, teamA: string, teamB: string, winsA: number, winsB: number): SeriesResult => ({
  matchId: `${date}-${teamA}-${teamB}`,
  startTime: `${date}T10:00:00Z`,
  block,
  bestOf: winsA + winsB > 3 ? 5 : winsA + winsB > 1 ? 3 : 1,
  state: "completed",
  teamA,
  teamB,
  winsA,
  winsB,
  winner: winsA > winsB ? teamA : teamB,
  league,
});

const series: SeriesResult[] = [
  sr("2026-02-01", "LPL 2026", "Week 1", "BLG", "TES", 2, 1),
  sr("2026-02-08", "LPL 2026", "Week 2", "BLG", "AL", 0, 2),
  sr("2026-03-01", "First Stand 2026", "Groups", "BLG", "GEN", 1, 2),
  sr("2026-03-10", "LCK 2026", "Week 3", "GEN", "T1", 2, 0),
  sr("2026-04-01", "LPL 2026", "Finals", "BLG", "TES", 3, 2),
  sr("2026-07-01", "MSI 2026", "Finals", "TES", "GEN", 3, 1),
  sr("2026-10-23", "Worlds 2026", "Swiss", "BLG", "TES", 1, 0),
];

describe("winner reconciliation", () => {
  const g = (number: number, blue: string, red: string, winner: string | null, towers: [number, number], inhib: [number, number], gold: number): GameSummary =>
    ({ ...summary(), gameId: `g${number}`, number, winner, goldDiff: [0, gold], blue: { ...summary().blue, code: blue, towers: towers[0], inhibitors: inhib[0] }, red: { ...summary().red, code: red, towers: towers[1], inhibitors: inhib[1] } }) as GameSummary;
  const s = (teamA: string, winsA: number, winsB: number, teamB: string) => sr("2026-08-01", "LPL 2026", "Week 1", teamA, teamB, winsA, winsB);
  it("gives the last game to the series winner", () => {
    expect(reconcileWinners([g(1, "T1", "HLE", "HLE", [1, 8], [0, 1], -8000), g(2, "HLE", "T1", null, [9, 1], [1, 0], 10000)], s("T1", 0, 2, "HLE"))).toEqual({ g2: "HLE" });
  });
  it("flips the least clear-cut games until the score matches", () => {
    const games = [
      g(1, "FUR", "LOS", "FUR", [10, 6], [3, 1], 900),
      g(2, "LOS", "FUR", "LOS", [8, 0], [1, 0], 9000),
      g(3, "LOS", "FUR", "FUR", [2, 10], [0, 2], -11700),
      g(4, "FUR", "LOS", "LOS", [1, 9], [0, 1], -11900),
    ];
    expect(reconcileWinners(games, s("FUR", 1, 3, "LOS"))).toEqual({ g1: "LOS" });
  });
  it("changes nothing when the frames already agree, or games are missing mid-series", () => {
    expect(reconcileWinners([g(1, "A", "B", "A", [9, 1], [1, 0], 5000)], s("A", 1, 0, "B"))).toEqual({});
    expect(reconcileWinners([g(1, "A", "B", "B", [9, 1], [1, 0], 5000)], s("A", 2, 1, "B"))).toEqual({});
  });
});

describe("usableEnd", () => {
  it("accepts a finished frame, or a feed that stopped late with an inhibitor down", () => {
    expect(usableEnd([f(0, tf(0), tf(0)), f(600, tf(0), tf(0), "finished")])).toBe(true);
    expect(usableEnd([f(0, tf(0), tf(0)), f(2000, tf(0, 0, 8, [], 1, 1), tf(0))])).toBe(true);
    expect(usableEnd([f(0, tf(0), tf(0)), f(950, tf(0), tf(0))])).toBe(false);
    expect(usableEnd([f(0, tf(0), tf(0)), f(88, tf(0), tf(0))])).toBe(false);
  });
});

describe("series records", () => {
  it("parses a league schedule into labelled series and applies team aliases", () => {
    const json = { data: { schedule: { events: [
      { startTime: "2026-07-10T10:00:00Z", state: "completed", blockName: "Groups", match: { id: "x1", strategy: { count: 3 }, teams: [{ code: "AGAL", result: { outcome: "win", gameWins: 2 } }, { code: "ML", result: { outcome: "loss", gameWins: 0 } }] } },
      { startTime: "2025-07-10T10:00:00Z", state: "completed", blockName: "Groups", match: { id: "x0", strategy: { count: 1 }, teams: [{ code: "T1", result: { outcome: "win", gameWins: 1 } }, { code: "GEN", result: { outcome: "loss", gameWins: 0 } }] } },
      { startTime: "2026-07-11T10:00:00Z", state: "unstarted", blockName: "Groups", match: { id: "x2", strategy: { count: 3 }, teams: [{ code: "T1" }, { code: "GEN" }] } },
    ] } } };
    expect(parseLeagueSeries(json, "EWC 2026")).toEqual([expect.objectContaining({ matchId: "x1", league: "EWC 2026", teamA: "AL", teamB: "LOS", winner: "AL", winsA: 2, winsB: 0 })]);
  });
  it("lists the season's head-to-heads newest first", () => {
    expect(headToHead("TES", "BLG", series).map((s) => s.matchId)).toEqual(["2026-10-23-BLG-TES", "2026-04-01-BLG-TES", "2026-02-01-BLG-TES"]);
  });
});

describe("aggregateTeam", () => {
  const games = [summary()];
  const t = aggregateTeam("BLG", series, games, { BLG: "LPL 2026", TES: "LPL 2026", AL: "LPL 2026", GEN: "LCK 2026", T1: "LCK 2026" });
  it("counts season series and games, per source, and recent form", () => {
    expect(t.homeLeague).toBe("LPL 2026");
    expect(t.season).toEqual({ series: { w: 3, l: 2 }, games: { w: 7, l: 7 } });
    expect(t.sources.find((s) => s.label === "LPL 2026")).toEqual({ label: "LPL 2026", series: { w: 2, l: 1 }, games: { w: 5, l: 5 }, titles: 1, finalsLost: 0 });
    expect(t.form).toBe("WWLLW");
    expect(t.vsInternational).toEqual({ w: 0, l: 1 });
  });
  it("aggregates livestats over its sampled games", () => {
    expect(t.stats).toMatchObject({ games: 1, wins: 1, avgGoldDiff15: -3000, firstBloodRate: 1, firstTowerRate: 0, firstDragonRate: 0, comebackWins: 1, throws: 0, leadAt15: { led: 0, won: 0 }, avgFirstBaronMin: 24 });
    expect(t.stats!.topChampions.top[0]).toEqual({ champion: "Rumble", count: 1 });
    expect(t.worldsStats!.games).toBe(1);
    const tes = aggregateTeam("TES", series, games, {});
    expect(tes.stats).toMatchObject({ throws: 1, comebackWins: 0, leadAt15: { led: 1, won: 0 } });
  });
  it("buildTeams covers every listed team", () => {
    expect(Object.keys(buildTeams(["BLG", "TES"], series, games))).toEqual(["BLG", "TES"]);
  });
  it("samples all Worlds games plus only the most recent games elsewhere", () => {
    const g = summary();
    const older = { ...g, gameId: "old", league: "LPL 2026", date: "2026-02-01T00:00:00Z" };
    const newer = { ...g, gameId: "new", league: "LPL 2026", date: "2026-04-01T00:00:00Z" };
    expect(sampleGames("BLG", [older, g, newer], 1).map((x) => x.gameId)).toEqual(["new", "g1"]);
    expect(sampleGames("ZZZ", [g])).toEqual([]);
  });
});

describe("champ", () => {
  it("turns feed ids into display names", () => {
    expect(champ("MissFortune")).toBe("Miss Fortune");
    expect(champ("MonkeyKing")).toBe("Wukong");
    expect(champ("KSante")).toBe("K'Sante");
  });
});

describe("digestFor", () => {
  const games = [summary()];
  const teams = buildTeams(["BLG", "TES", "GEN"], series, games);
  const text = digestFor("BLG", "TES", teams, series, games);
  it("labels sources, records, head-to-head and moments, within 30 lines", () => {
    expect(text).toContain("BLG");
    expect(text).toContain("LPL 2026");
    expect(text).toContain("Worlds 2026");
    expect(text).toMatch(/Head-to-head 2026: BLG 3-0 TES/);
    expect(text).toContain("BLG came back from -4.2k at 20:00 vs TES (Worlds 2026)");
    expect(text.split("\n").length).toBeLessThanOrEqual(30);
  });
  it("adds at most two fun facts", () => {
    const withFacts = games.map((g) => ({
      ...g,
      funFacts: [
        { kind: "multikill", team: "BLG", text: "Likely penta kill: BLG Viper (Kai'Sa) at 31:10" },
        { kind: "stomp", team: "BLG", text: "BLG won in 22:00" },
        { kind: "roughDay", team: "TES", text: "TES 369 (Rumble) finished 0/8/1" },
      ],
    }));
    const t = digestFor("BLG", "TES", teams, series, withFacts);
    expect(t).toContain("Fun facts:");
    expect(t).toContain("Likely penta kill: BLG Viper (Kai'Sa) at 31:10 (vs TES, Worlds 2026)");
    expect(t.split("\n").filter((l) => l.startsWith("  * ")).length).toBe(2);
    expect(t.split("\n").length).toBeLessThanOrEqual(30);
  });
  it("lists comebacks, throws and big swings as moments", () => {
    expect(moments("BLG", games)).toContain("BLG swung 8.5k in 5 min (23:00-28:00) vs TES (Worlds 2026)");
    expect(moments("TES", games)).toContain("TES threw a +4.2k lead (20:00) vs BLG (Worlds 2026)");
  });
  it("says so when a team has no data", () => {
    expect(digestFor("BLG", "ZZZ", teams, series, games)).toContain("ZZZ: no 2026 data");
  });
});
