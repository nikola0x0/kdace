// Scout: a stats digest per team from the official lolesports feeds (schedules, event details, livestats).
// Pure functions only (no fs, no fetch) so the web app can import them; the fetching lives in src/jobs/scout.ts.
import { parseSchedule, type Series } from "./worlds.ts";

export type Role = "top" | "jungle" | "mid" | "bottom" | "support";
export type Side = "blue" | "red";
export const ROLES: Role[] = ["top", "jungle", "mid", "bottom", "support"];

/** A completed 2026 series from a league schedule, tagged with its source ("LCK 2026", "Worlds 2026"). */
export type SeriesResult = Series & { league: string };

export type TeamFrame = { gold: number; kills: number; towers: number; inhibitors: number; barons: number; dragons: string[] };
export type PlayerFrame = { participantId: number; kills: number; deaths: number; assists: number; gold: number; cs: number };
export type Frame = { ts: string; state: string; blue: TeamFrame; red: TeamFrame; players?: PlayerFrame[] };
export type PlayerMeta = { participantId: number; name: string; champion: string; role: Role };
export type GameMeta = { gameId: string; matchId: string; patch: string; blue: { teamId: string; players: PlayerMeta[] }; red: { teamId: string; players: PlayerMeta[] } };
export type PlayerDetail = {
  participantId: number;
  kills: number;
  deaths: number;
  assists: number;
  damageShare: number | null;
  killParticipation: number | null;
  cs?: number | null;
  wards?: number | null;
};
/** A light, strictly data-derived observation about a game ("Likely quadra kill: ... at 20:30"). */
export type FunFact = { kind: string; team: string | null; text: string };
export type EventInfo = { matchId: string; teams: { id: string; code: string }[]; games: { id: string; number: number; state: string; blueId: string; redId: string }[] };

export type SideSummary = {
  code: string;
  champions: Record<Role, string>;
  gold15: number | null;
  kills: number;
  towers: number;
  inhibitors: number;
  dragons: string[];
  barons: number;
  firstBlood: boolean | null;
  firstTower: boolean | null;
  firstDragon: boolean | null;
  firstBaronMin: number | null;
};
export type GameEvent = { min: number; type: "firstBlood" | "firstTower" | "dragon" | "elder" | "baron" | "inhibitor" | "end"; team: string; detail?: string; behind?: number };
export type PlayerLine = { code: string; name: string; champion: string; role: Role; k: number; d: number; a: number; damageShare: number | null };
export type GameSummary = {
  gameId: string;
  matchId: string;
  number: number;
  league: string;
  date: string;
  patch: string;
  durationMin: number;
  /** False when the feed stopped without a "finished" frame (totals are the last ones seen, duration is approximate). */
  complete: boolean;
  winner: string | null;
  blue: SideSummary;
  red: SideSummary;
  /** Blue gold minus red gold at each minute of game time (index = minute; null where that minute wasn't sampled). */
  goldDiff: (number | null)[];
  /** Blue-minus-red gold difference at 10/15/20/25 minutes (missing when the game ended earlier). */
  leads: Partial<Record<10 | 15 | 20 | 25, number>>;
  maxLead: { blue: { gold: number; min: number }; red: { gold: number; min: number } };
  /** Largest one-way gold movement in a team's favour. */
  swing: { team: string; gold: number; fromMin: number; toMin: number } | null;
  /** The winner trailed by at least 3k at some point. */
  comeback: { team: string; deficit: number; min: number } | null;
  events: GameEvent[];
  players: PlayerLine[];
  standout: PlayerLine | null;
  funFacts: FunFact[];
};

/** Team codes that differ between events for the same organisation (EWC uses its own tags). */
export const TEAM_ALIASES: Record<string, string> = { AGAL: "AL", ML: "LOS", TS: "TSW" };
const alias = (code: string) => TEAM_ALIASES[code] ?? code;

export const INTERNATIONAL = ["Worlds", "MSI", "First Stand", "EWC", "Americas Cup"];
export const isInternational = (label: string) => INTERNATIONAL.some((n) => label.startsWith(n + " "));

const COMEBACK_GOLD = 3000;
const LEAD_GOLD = 1000;
const BEHIND_GOLD = 1000;
const SWING_MIN = 5;

// ---------- parsing ----------

export function parseLeagueSeries(json: any, league: string): SeriesResult[] {
  return parseSchedule(json)
    .filter((s) => s.state === "completed" && s.winner)
    .map((s) => ({ ...s, teamA: alias(s.teamA), teamB: alias(s.teamB), winner: alias(s.winner!), league }));
}

export function parseEvent(json: any): EventInfo {
  const m = json?.data?.event?.match ?? {};
  return {
    matchId: json?.data?.event?.id,
    teams: (m.teams ?? []).map((t: any) => ({ id: t.id, code: alias(t.code) })),
    games: (m.games ?? []).map((g: any) => ({
      id: g.id,
      number: g.number,
      state: g.state,
      blueId: g.teams?.find((t: any) => t.side === "blue")?.id,
      redId: g.teams?.find((t: any) => t.side === "red")?.id,
    })),
  };
}

const teamFrame = (t: any): TeamFrame => ({
  gold: t?.totalGold ?? 0,
  kills: t?.totalKills ?? 0,
  towers: t?.towers ?? 0,
  inhibitors: t?.inhibitors ?? 0,
  barons: t?.barons ?? 0,
  dragons: [...(t?.dragons ?? [])],
});

export function parseWindow(json: any): { meta: GameMeta | null; frames: Frame[] } {
  const gm = json?.gameMetadata;
  const players = (side: any): PlayerMeta[] =>
    (side?.participantMetadata ?? []).map((p: any) => ({ participantId: p.participantId, name: String(p.summonerName ?? "").trim(), champion: p.championId, role: p.role }));
  const meta: GameMeta | null = gm
    ? {
        gameId: json.esportsGameId,
        matchId: json.esportsMatchId,
        patch: String(gm.patchVersion ?? "").split(".").slice(0, 2).join("."),
        blue: { teamId: gm.blueTeamMetadata?.esportsTeamId, players: players(gm.blueTeamMetadata) },
        red: { teamId: gm.redTeamMetadata?.esportsTeamId, players: players(gm.redTeamMetadata) },
      }
    : null;
  const frames: Frame[] = (json?.frames ?? []).map((f: any) => {
    const ps = [...(f.blueTeam?.participants ?? []), ...(f.redTeam?.participants ?? [])];
    const frame: Frame = { ts: f.rfc460Timestamp, state: f.gameState, blue: teamFrame(f.blueTeam), red: teamFrame(f.redTeam) };
    if (ps.length)
      frame.players = ps.map((p: any) => ({ participantId: p.participantId, kills: p.kills, deaths: p.deaths, assists: p.assists, gold: p.totalGold, cs: p.creepScore }));
    return frame;
  });
  return { meta, frames };
}

/** Per-player stats from the last frame of a details payload. */
export function parseDetails(json: any): PlayerDetail[] {
  const last = (json?.frames ?? []).at(-1);
  return (last?.participants ?? []).map((p: any) => ({
    participantId: p.participantId,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    damageShare: typeof p.championDamageShare === "number" ? p.championDamageShare : null,
    killParticipation: typeof p.killParticipation === "number" ? p.killParticipation : null,
    cs: typeof p.creepScore === "number" ? p.creepScore : null,
    wards: typeof p.wardsPlaced === "number" ? p.wardsPlaced : null,
  }));
}

export function mergeFrames(...lists: Frame[][]): Frame[] {
  const byTs = new Map<string, Frame>();
  for (const l of lists) for (const f of l) if (f?.ts) byTs.set(f.ts, f);
  return [...byTs.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

// ---------- timing ----------

/** RFC3339 time rounded down to a multiple of 10 seconds (what the livestats feed accepts). */
export function floor10(ms: number): string {
  return new Date(Math.floor(ms / 10_000) * 10_000).toISOString().replace(".000Z", "Z");
}

/** Window start times every `stepSec` of game time after `startTs`, before `endTs`. */
export function sampleTimes(startTs: string, endTs: string, stepSec = 60, checkpointsMin = [10, 15, 20, 25]): string[] {
  const t0 = Date.parse(startTs);
  const end = Date.parse(endTs);
  const out = new Set<string>();
  for (let t = t0 + stepSec * 1000; t < end; t += stepSec * 1000) out.add(floor10(t));
  for (const m of checkpointsMin) if (t0 + m * 60_000 < end) out.add(floor10(t0 + m * 60_000));
  return [...out].sort();
}

// ---------- first objectives ----------

type Metric = "kills" | "towers" | "dragons";
const val = (t: TeamFrame, m: Metric) => (m === "dragons" ? t.dragons.length : t[m]);

function firstIndex(frames: Frame[], m: Metric): number {
  return frames.findIndex((f) => val(f.blue, m) > 0 || val(f.red, m) > 0);
}

/** The side that got the metric first, or null if nobody did or both appear in the same frame. */
export function firstTo(frames: Frame[], m: Metric): Side | null {
  const i = firstIndex(frames, m);
  if (i < 0) return null;
  const b = val(frames[i].blue, m) > 0;
  const r = val(frames[i].red, m) > 0;
  return b && !r ? "blue" : r && !b ? "red" : null;
}

/** A window start time that would settle an unresolved first objective, or null if none is needed or possible. */
export function nextProbe(frames: Frame[], metrics: Metric[]): string | null {
  for (const m of metrics) {
    const i = firstIndex(frames, m);
    if (i <= 0 || firstTo(frames, m)) continue;
    const lo = Date.parse(frames[i - 1].ts);
    const hi = Date.parse(frames[i].ts);
    // One window covers ~10 seconds from its start; a gap inside one window can't be split further.
    if (hi - lo <= 10_000) continue;
    const probe = floor10(lo + (hi - lo) / 2);
    const p = Date.parse(probe);
    if (p > lo && p < hi) return probe;
    if (Math.floor(lo / 10_000) * 10_000 + 10_000 < hi) return floor10(lo + 10_000);
  }
  return null;
}

// ---------- game summary ----------

const minutesBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 60_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

function frameNear(frames: Frame[], targetMs: number, toleranceMs = 45_000): Frame | null {
  let best: Frame | null = null;
  let bestGap = Infinity;
  for (const f of frames) {
    const gap = Math.abs(Date.parse(f.ts) - targetMs);
    if (gap < bestGap) {
      best = f;
      bestGap = gap;
    }
  }
  return bestGap <= toleranceMs ? best : null;
}

/** True when the frames reach the end of a game: a finished frame, or a feed that stopped 20+ minutes in with an inhibitor down. */
export function usableEnd(frames: Frame[]): boolean {
  const last = frames.at(-1);
  if (!last || frames.length < 2) return false;
  if (last.state === "finished") return true;
  return minutesBetween(frames[0].ts, last.ts) >= 20 && last.blue.inhibitors + last.red.inhibitors > 0;
}

/**
 * Per-game winners that must change so the games add up to the official series score. The series winner always
 * takes the last game; beyond that, the least clear-cut frame calls (towers, inhibitors, final gold) are flipped.
 * Returns gameId -> corrected winner, only for games whose winner changes.
 */
export function reconcileWinners(games: GameSummary[], s: SeriesResult): Record<string, string> {
  const total = (s.winsA ?? 0) + (s.winsB ?? 0);
  const sorted = [...games].sort((a, b) => a.number - b.number);
  const winners = new Map(sorted.map((g) => [g.gameId, g.winner]));
  const last = sorted.find((g) => g.number === total);
  if (last && s.winner) winners.set(last.gameId, s.winner);
  if (sorted.length === total && s.winner) {
    const margin = (g: GameSummary) => {
      const gold = [...g.goldDiff].reverse().find((d) => d !== null) ?? 0;
      return Math.abs(g.blue.towers - g.red.towers) * 3 + Math.abs(g.blue.inhibitors - g.red.inhibitors) * 2 + Math.abs(gold) / 1000;
    };
    const need: Record<string, number> = { [s.teamA]: s.winsA ?? 0, [s.teamB]: s.winsB ?? 0 };
    const flippable = sorted.filter((g) => g !== last).sort((a, b) => (winners.get(a.gameId) ? margin(a) : -1) - (winners.get(b.gameId) ? margin(b) : -1));
    const count = (t: string) => [...winners.values()].filter((w) => w === t).length;
    for (const g of flippable) {
      const w = winners.get(g.gameId) ?? null;
      const other = w === s.teamA ? s.teamB : w === s.teamB ? s.teamA : null;
      if (w && other && count(w) > need[w] && count(other) < need[other]) winners.set(g.gameId, other);
      else if (!w) winners.set(g.gameId, count(s.teamA) < need[s.teamA] ? s.teamA : s.teamB);
    }
  }
  const out: Record<string, string> = {};
  for (const g of sorted) {
    const w = winners.get(g.gameId);
    if (w && w !== g.winner) out[g.gameId] = w;
  }
  return out;
}

function pickWinner(last: Frame): Side | null {
  const b = last.blue;
  const r = last.red;
  if (b.towers !== r.towers) return b.towers > r.towers ? "blue" : "red";
  if (b.inhibitors !== r.inhibitors) return b.inhibitors > r.inhibitors ? "blue" : "red";
  if (b.gold !== r.gold) return b.gold > r.gold ? "blue" : "red";
  return null;
}

export type GameInput = {
  meta: GameMeta;
  frames: Frame[];
  details: PlayerDetail[];
  /** esportsTeamId -> team code. */
  teams: Record<string, string>;
  league: string;
  number: number;
  /** The winner when known from elsewhere (e.g. reconciled with the series score); overrides the frame heuristic. */
  winnerHint: string | null;
};

export function summarizeGame(input: GameInput): GameSummary {
  const { meta, details } = input;
  const frames = mergeFrames(input.frames);
  const t0 = frames[0].ts;
  const t0ms = Date.parse(t0);
  const last = frames.at(-1)!;
  const code = { blue: alias(input.teams[meta.blue.teamId] ?? meta.blue.teamId), red: alias(input.teams[meta.red.teamId] ?? meta.red.teamId) };
  const sideOf = (team: string): Side => (team === code.blue ? "blue" : "red");
  const minOf = (ts: string) => round1(minutesBetween(t0, ts));

  // Gold story, one sample per minute.
  const duration = minutesBetween(t0, last.ts);
  const goldDiff: number[] = [];
  for (let m = 0; m <= Math.floor(duration); m++) {
    const f = frameNear(frames, t0ms + m * 60_000);
    goldDiff.push(f ? f.blue.gold - f.red.gold : NaN);
  }
  const series = goldDiff.map((d, m) => ({ d, m })).filter((x) => !Number.isNaN(x.d));
  const leads: GameSummary["leads"] = {};
  for (const m of [10, 15, 20, 25] as const) if (m < goldDiff.length && !Number.isNaN(goldDiff[m])) leads[m] = goldDiff[m];
  const maxLead = { blue: { gold: 0, min: 0 }, red: { gold: 0, min: 0 } };
  for (const { d, m } of series) {
    if (d > maxLead.blue.gold) maxLead.blue = { gold: d, min: m };
    if (-d > maxLead.red.gold) maxLead.red = { gold: -d, min: m };
  }
  let swing: GameSummary["swing"] = null;
  // Largest gold movement within any SWING_MIN-minute span (a fight, a baron, a pick-off chain).
  for (let j = 0; j < series.length; j++)
    for (let i = j - 1; i >= 0 && series[j].m - series[i].m <= SWING_MIN; i--) {
      const delta = series[j].d - series[i].d;
      if (Math.abs(delta) > (swing?.gold ?? 0)) swing = { team: delta > 0 ? code.blue : code.red, gold: Math.abs(delta), fromMin: series[i].m, toMin: series[j].m };
    }

  const winnerSide: Side | null = input.winnerHint ? sideOf(alias(input.winnerHint)) : pickWinner(last);
  const winner = winnerSide ? code[winnerSide] : null;
  let comeback: GameSummary["comeback"] = null;
  if (winnerSide) {
    const deficit = maxLead[winnerSide === "blue" ? "red" : "blue"];
    if (deficit.gold >= COMEBACK_GOLD) comeback = { team: code[winnerSide], deficit: deficit.gold, min: deficit.min };
  }

  // Key moments from consecutive frames.
  const events: GameEvent[] = [];
  const fb = firstTo(frames, "kills");
  const ft = firstTo(frames, "towers");
  const fd = firstTo(frames, "dragons");
  const atFirst = (m: Metric) => frames[firstIndex(frames, m)];
  if (fb) events.push({ min: minOf(atFirst("kills").ts), type: "firstBlood", team: code[fb] });
  if (ft) events.push({ min: minOf(atFirst("towers").ts), type: "firstTower", team: code[ft] });
  const firstBaronMin: Record<Side, number | null> = { blue: null, red: null };
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const cur = frames[i];
    const min = minOf(cur.ts);
    for (const side of ["blue", "red"] as const) {
      const team = code[side];
      const lead = side === "blue" ? prev.blue.gold - prev.red.gold : prev.red.gold - prev.blue.gold;
      const behind = lead <= -BEHIND_GOLD ? -lead : undefined;
      const withBehind = (e: GameEvent): GameEvent => (behind ? { ...e, behind } : e);
      for (const d of cur[side].dragons.slice(prev[side].dragons.length))
        events.push(withBehind(d === "elder" ? { min, type: "elder", team } : { min, type: "dragon", team, detail: d }));
      if (cur[side].barons > prev[side].barons) {
        events.push(withBehind({ min, type: "baron", team }));
        firstBaronMin[side] ??= min;
      }
      if (cur[side].inhibitors > prev[side].inhibitors) events.push({ min, type: "inhibitor", team });
    }
  }
  if (winner) events.push({ min: round1(duration), type: "end", team: winner });
  events.sort((a, b) => a.min - b.min);

  // Players: KDA from the details feed, else the last window frame.
  const byId = new Map<number, { k: number; d: number; a: number; damageShare: number | null }>();
  for (const p of last.players ?? []) byId.set(p.participantId, { k: p.kills, d: p.deaths, a: p.assists, damageShare: null });
  for (const p of details) byId.set(p.participantId, { k: p.kills, d: p.deaths, a: p.assists, damageShare: p.damageShare });
  const players: PlayerLine[] = [];
  for (const side of ["blue", "red"] as const)
    for (const p of meta[side].players) {
      const s = byId.get(p.participantId);
      if (s) players.push({ code: code[side], name: p.name, champion: p.champion, role: p.role, k: s.k, d: s.d, a: s.a, damageShare: s.damageShare === null ? null : round1(s.damageShare * 100) / 100 });
    }
  const kda = (p: PlayerLine) => (p.k + p.a) / Math.max(1, p.d);
  const standout = [...players].sort((a, b) => b.k - a.k || kda(b) - kda(a))[0] ?? null;

  const funFacts = findFunFacts({ meta, frames, details, code, t0ms, duration, winner, events, comeback, players, firstBloodFrame: fb ? atFirst("kills") : null, fb });

  const side15 = frameNear(frames, t0ms + 15 * 60_000);
  const sideSummary = (side: Side): SideSummary => {
    const champions = Object.fromEntries(ROLES.map((r) => [r, meta[side].players.find((p) => p.role === r)?.champion ?? ""])) as Record<Role, string>;
    const first = (s: Side | null) => (s ? s === side : null);
    return {
      code: code[side],
      champions,
      gold15: side15 ? side15[side].gold : null,
      kills: last[side].kills,
      towers: last[side].towers,
      inhibitors: last[side].inhibitors,
      dragons: last[side].dragons,
      barons: last[side].barons,
      firstBlood: first(fb),
      firstTower: first(ft),
      firstDragon: first(fd),
      firstBaronMin: firstBaronMin[side],
    };
  };

  return {
    gameId: meta.gameId,
    matchId: meta.matchId,
    number: input.number,
    league: input.league,
    date: t0,
    patch: meta.patch,
    durationMin: round1(duration),
    complete: last.state === "finished",
    winner,
    blue: sideSummary("blue"),
    red: sideSummary("red"),
    goldDiff: goldDiff.map((d) => (Number.isNaN(d) ? null : d)),
    leads,
    maxLead,
    swing,
    comeback,
    events,
    players,
    standout,
    funFacts,
  };
}

// ---------- fun facts ----------

const MULTI_KILL_SEC = 30;
const ROUGH_PATCH_SEC = 245; // ~4 minutes: death timers make 3 deaths in 2 minutes almost impossible after the early game
const MULTI = ["", "", "", "triple", "quadra", "penta"];

/** Window start times (10 s apart) that fill any gap over 30 s where one player's kills rose by 3+, so multi-kills can be checked. */
export function densifyTimes(frames: Frame[]): string[] {
  const out = new Set<string>();
  const have = new Set(frames.map((f) => floor10(Date.parse(f.ts))));
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    const lo = Date.parse(a.ts);
    const hi = Date.parse(b.ts);
    if (hi - lo <= MULTI_KILL_SEC * 1000 || !a.players || !b.players) continue;
    const jump = b.players.some((p) => p.kills - (a.players!.find((q) => q.participantId === p.participantId)?.kills ?? p.kills) >= 3);
    if (!jump) continue;
    for (let t = Math.floor(lo / 10_000) * 10_000 + 10_000; t < hi; t += 10_000) {
      const iso = floor10(t);
      if (!have.has(iso)) out.add(iso);
    }
  }
  return [...out].sort();
}

function findFunFacts(x: {
  meta: GameMeta;
  frames: Frame[];
  details: PlayerDetail[];
  code: Record<Side, string>;
  t0ms: number;
  duration: number;
  winner: string | null;
  events: GameEvent[];
  comeback: GameSummary["comeback"];
  players: PlayerLine[];
  firstBloodFrame: Frame | null;
  fb: Side | null;
}): FunFact[] {
  const facts: FunFact[] = [];
  const at = (ts: string) => clock((Date.parse(ts) - x.t0ms) / 60_000);
  const who = new Map<number, { team: string; name: string; champion: string; role: Role }>();
  for (const side of ["blue", "red"] as const) for (const p of x.meta[side].players) who.set(p.participantId, { team: x.code[side], name: p.name, champion: champ(p.champion), role: p.role });
  const label = (id: number) => `${who.get(id)!.name} (${who.get(id)!.champion})`;
  const withPlayers = x.frames.filter((f) => f.players?.length);

  // Per-player streaks from frames: kills rising 3+ inside 30 s, deaths rising 3+ inside ~2 min.
  for (const id of who.keys()) {
    const series = withPlayers.map((f) => ({ ms: Date.parse(f.ts), ts: f.ts, p: f.players!.find((p) => p.participantId === id) })).filter((s) => s.p);
    // Every frame j where 3+ kills landed since the earliest frame within 30 s; overlapping spans are one burst.
    const bursts: { n: number; start: number; end: number; ts: string }[] = [];
    for (let j = 0; j < series.length; j++) {
      const i = series.findIndex((s) => series[j].ms - s.ms <= MULTI_KILL_SEC * 1000);
      const n = series[j].p!.kills - series[i].p!.kills;
      if (n < 3) continue;
      const prev = bursts.at(-1);
      if (prev && series[i].ms < prev.end) {
        if (n > prev.n) Object.assign(prev, { n, end: series[j].ms, ts: series[j].ts });
        else prev.end = Math.max(prev.end, series[j].ms);
      } else bursts.push({ n, start: series[i].ms, end: series[j].ms, ts: series[j].ts });
    }
    for (const b of bursts) facts.push({ kind: "multikill", team: who.get(id)!.team, text: `Likely ${MULTI[Math.min(5, b.n)]} kill: ${label(id)} at ${at(b.ts)}` });
    for (let j = 0; j < series.length; j++) {
      const i = series.findIndex((s) => series[j].ms - s.ms <= ROUGH_PATCH_SEC * 1000);
      if (i >= 0 && i < j && series[j].p!.deaths - series[i].p!.deaths >= 3) {
        facts.push({ kind: "roughPatch", team: who.get(id)!.team, text: `${label(id)} died ${series[j].p!.deaths - series[i].p!.deaths} times between ${at(series[i].ts)} and ${at(series[j].ts)}` });
        break;
      }
    }
  }

  // Final lines.
  for (const p of x.players) {
    const id = x.meta.blue.players.concat(x.meta.red.players).find((m) => m.name === p.name && m.champion === p.champion)?.participantId;
    if (id === undefined) continue;
    if (p.d >= 8 && p.k <= 1) facts.push({ kind: "roughDay", team: p.code, text: `${label(id)} finished ${p.k}/${p.d}/${p.a}` });
    if (p.d === 0 && p.k + p.a >= 10) facts.push({ kind: "perfect", team: p.code, text: `${label(id)} went ${p.k}/${p.d}/${p.a} without dying` });
  }

  // Game shape.
  if (x.firstBloodFrame && x.fb && Date.parse(x.firstBloodFrame.ts) - x.t0ms < 120_000)
    facts.push({ kind: "earlyBlood", team: x.code[x.fb], text: `First blood before ${at(x.firstBloodFrame.ts)} (${x.code[x.fb]})` });
  const at10 = frameNear(x.frames, x.t0ms + 600_000, 15_000);
  if (at10 && at10.blue.kills + at10.red.kills === 0) facts.push({ kind: "peaceful", team: null, text: "No kills before 10:00" });
  if (x.duration >= 40) facts.push({ kind: "marathon", team: null, text: `Marathon: ${clock(x.duration)}` });
  if (x.winner && x.duration < 25) facts.push({ kind: "stomp", team: x.winner, text: `${x.winner} won in ${clock(x.duration)}` });
  if (x.comeback && x.comeback.deficit >= 10_000) facts.push({ kind: "bigComeback", team: x.comeback.team, text: `${x.comeback.team} came back from ${(x.comeback.deficit / 1000).toFixed(1)}k down` });
  let steals = 0;
  for (const e of x.events) {
    if (!e.behind) continue;
    if (e.type === "elder" && e.team === x.winner) facts.push({ kind: "elderFlip", team: e.team, text: `${e.team} took Elder at ${clock(e.min)} while ${(e.behind / 1000).toFixed(1)}k down and won` });
    else if (((e.type === "baron" && e.behind >= 3000) || (e.type === "dragon" && e.behind >= 4000)) && steals++ < 2) {
      const what = e.type === "baron" ? "Baron" : e.detail ? `${/^[aeiou]/.test(e.detail) ? "an" : "a"} ${e.detail} dragon` : "a dragon";
      facts.push({ kind: "steal", team: e.team, text: `${e.team} took ${what} at ${clock(e.min)} while ${(e.behind / 1000).toFixed(1)}k down` });
    }
  }

  // Odd stats from the details feed.
  for (const d of x.details) {
    const p = who.get(d.participantId);
    if (!p) continue;
    if (d.cs != null && ["top", "mid", "bottom"].includes(p.role) && x.duration >= 15 && d.cs / x.duration < 5)
      facts.push({ kind: "cs", team: p.team, text: `${label(d.participantId)} had ${d.cs} CS in ${Math.floor(x.duration)} min` });
    if (d.wards != null && x.duration >= 15 && d.wards / x.duration >= 3) facts.push({ kind: "wards", team: p.team, text: `${label(d.participantId)} placed ${d.wards} wards` });
    if (d.damageShare !== null && d.damageShare >= 0.4)
      facts.push({ kind: "damage", team: p.team, text: `${label(d.participantId)} dealt ${Math.round(d.damageShare * 100)}% of ${p.team}'s champion damage` });
  }
  return facts;
}

// ---------- aggregates ----------

export type Record2 = { w: number; l: number };
export type SourceRecord = { label: string; series: Record2; games: Record2; titles: number; finalsLost: number };
export type ChampionCount = { champion: string; count: number };
export type TeamStats = {
  games: number;
  wins: number;
  avgGoldDiff15: number | null;
  firstBloodRate: number | null;
  firstTowerRate: number | null;
  firstDragonRate: number | null;
  dragonShare: number | null;
  avgBarons: number;
  avgFirstBaronMin: number | null;
  avgDurationMin: number;
  comebackWins: number;
  throws: number;
  /** Games where the team was 1k+ ahead at 15 minutes, and how many of those it won. */
  leadAt15: { led: number; won: number };
  objectivesWhileBehind: number;
  topChampions: Record<Role, ChampionCount[]>;
  standout: { name: string; role: Role; kda: number; games: number; damageShare: number | null } | null;
};
export type TeamAggregate = {
  code: string;
  homeLeague: string | null;
  season: { series: Record2; games: Record2 };
  sources: SourceRecord[];
  /** Last 10 series, newest first. */
  form: string;
  vsInternational: Record2;
  /** Livestats over the team's sampled games (Worlds 2026 plus the most recent games elsewhere). */
  stats: TeamStats | null;
  worldsStats: TeamStats | null;
};

const involves = (s: SeriesResult, code: string) => s.teamA === code || s.teamB === code;
const won = (s: SeriesResult, code: string) => s.winner === code;
const gamesOf = (s: SeriesResult, code: string) => (s.teamA === code ? { w: s.winsA ?? 0, l: s.winsB ?? 0 } : { w: s.winsB ?? 0, l: s.winsA ?? 0 });
const byNewest = (a: { startTime: string }, b: { startTime: string }) => b.startTime.localeCompare(a.startTime);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (xs: (boolean | null)[]) => avg(xs.filter((x): x is boolean => x !== null).map((x) => (x ? 1 : 0)));

/** Each team's home league: the non-international source it played the most series in. */
export function homeLeagues(series: SeriesResult[]): Record<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const s of series) {
    if (isInternational(s.league)) continue;
    for (const t of [s.teamA, s.teamB]) {
      const m = counts.get(t) ?? new Map<string, number>();
      m.set(s.league, (m.get(s.league) ?? 0) + 1);
      counts.set(t, m);
    }
  }
  const out: Record<string, string> = {};
  for (const [t, m] of counts) out[t] = [...m].sort((a, b) => b[1] - a[1])[0][0];
  return out;
}

export function headToHead(a: string, b: string, series: SeriesResult[]): SeriesResult[] {
  return series.filter((s) => involves(s, a) && involves(s, b)).sort(byNewest);
}

export function teamStats(code: string, games: GameSummary[]): TeamStats | null {
  const mine = games.filter((g) => g.blue.code === code || g.red.code === code);
  if (!mine.length) return null;
  const sideOf = (g: GameSummary): Side => (g.blue.code === code ? "blue" : "red");
  const us = (g: GameSummary) => g[sideOf(g)];
  const them = (g: GameSummary) => g[sideOf(g) === "blue" ? "red" : "blue"];
  const sign = (g: GameSummary) => (sideOf(g) === "blue" ? 1 : -1);
  const wins = mine.filter((g) => g.winner === code);
  const gd15 = mine.filter((g) => us(g).gold15 !== null && them(g).gold15 !== null).map((g) => us(g).gold15! - them(g).gold15!);
  const dragonsUs = mine.reduce((n, g) => n + us(g).dragons.length, 0);
  const dragonsAll = mine.reduce((n, g) => n + us(g).dragons.length + them(g).dragons.length, 0);
  const ahead15 = mine.filter((g) => g.leads[15] !== undefined && sign(g) * g.leads[15]! >= LEAD_GOLD);
  const throws = mine.filter((g) => g.winner && g.winner !== code && g.maxLead[sideOf(g)].gold >= COMEBACK_GOLD).length;

  const topChampions = {} as Record<Role, ChampionCount[]>;
  for (const r of ROLES) {
    const counts = new Map<string, number>();
    for (const g of mine) {
      const c = us(g).champions[r];
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    topChampions[r] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([champion, count]) => ({ champion, count }));
  }

  const perPlayer = new Map<string, { role: Role; k: number; d: number; a: number; games: number; dmg: number[] }>();
  for (const g of mine)
    for (const p of g.players.filter((x) => x.code === code)) {
      const e = perPlayer.get(p.name) ?? { role: p.role, k: 0, d: 0, a: 0, games: 0, dmg: [] };
      e.k += p.k;
      e.d += p.d;
      e.a += p.a;
      e.games++;
      if (p.damageShare !== null) e.dmg.push(p.damageShare);
      perPlayer.set(p.name, e);
    }
  const minGames = Math.min(3, mine.length);
  const standoutEntry = [...perPlayer]
    .filter(([, e]) => e.games >= minGames)
    .map(([name, e]) => ({ name, role: e.role, kda: round1((e.k + e.a) / Math.max(1, e.d)), games: e.games, damageShare: e.dmg.length ? Math.round(avg(e.dmg)! * 100) / 100 : null }))
    .sort((a, b) => b.kda - a.kda)[0];

  const baronTimes = mine.map((g) => us(g).firstBaronMin).filter((x): x is number => x !== null);
  return {
    games: mine.length,
    wins: wins.length,
    avgGoldDiff15: gd15.length ? Math.round(avg(gd15)!) : null,
    firstBloodRate: rate(mine.map((g) => us(g).firstBlood)),
    firstTowerRate: rate(mine.map((g) => us(g).firstTower)),
    firstDragonRate: rate(mine.map((g) => us(g).firstDragon)),
    dragonShare: dragonsAll ? dragonsUs / dragonsAll : null,
    avgBarons: round1(avg(mine.map((g) => us(g).barons))!),
    avgFirstBaronMin: baronTimes.length ? round1(avg(baronTimes)!) : null,
    avgDurationMin: round1(avg(mine.map((g) => g.durationMin))!),
    comebackWins: mine.filter((g) => g.comeback?.team === code).length,
    throws,
    leadAt15: { led: ahead15.length, won: ahead15.filter((g) => g.winner === code).length },
    objectivesWhileBehind: mine.reduce((n, g) => n + g.events.filter((e) => e.team === code && e.behind && (e.type === "baron" || e.type === "elder" || e.type === "dragon")).length, 0),
    topChampions,
    standout: standoutEntry ?? null,
  };
}

export function aggregateTeam(code: string, series: SeriesResult[], games: GameSummary[], homes: Record<string, string>): TeamAggregate {
  const mine = series.filter((s) => involves(s, code)).sort(byNewest);
  const add = (r: Record2, x: Record2) => ({ w: r.w + x.w, l: r.l + x.l });
  let seriesRec: Record2 = { w: 0, l: 0 };
  let gamesRec: Record2 = { w: 0, l: 0 };
  const sources = new Map<string, SourceRecord>();
  for (const s of [...mine].reverse()) {
    const res = won(s, code) ? { w: 1, l: 0 } : { w: 0, l: 1 };
    seriesRec = add(seriesRec, res);
    gamesRec = add(gamesRec, gamesOf(s, code));
    const src = sources.get(s.league) ?? { label: s.league, series: { w: 0, l: 0 }, games: { w: 0, l: 0 }, titles: 0, finalsLost: 0 };
    src.series = add(src.series, res);
    src.games = add(src.games, gamesOf(s, code));
    if (/^finals?$/i.test(s.block.trim())) won(s, code) ? src.titles++ : src.finalsLost++;
    sources.set(s.league, src);
  }
  const home = homes[code] ?? null;
  const vsInternational = mine
    .filter((s) => {
      const opp = s.teamA === code ? s.teamB : s.teamA;
      return home && homes[opp] && homes[opp] !== home;
    })
    .reduce((r, s) => add(r, won(s, code) ? { w: 1, l: 0 } : { w: 0, l: 1 }), { w: 0, l: 0 });
  return {
    code,
    homeLeague: home,
    season: { series: seriesRec, games: gamesRec },
    sources: [...sources.values()],
    form: mine.slice(0, 10).map((s) => (won(s, code) ? "W" : "L")).join(""),
    vsInternational,
    stats: teamStats(code, games),
    worldsStats: teamStats(code, games.filter((g) => g.league.startsWith("Worlds "))),
  };
}

/** A team's livestats sample: all its Worlds 2026 games plus its `recent` most recent games elsewhere. */
export function sampleGames(code: string, games: GameSummary[], recent = 20): GameSummary[] {
  const mine = games.filter((g) => g.blue.code === code || g.red.code === code).sort((a, b) => b.date.localeCompare(a.date));
  const worlds = mine.filter((g) => g.league.startsWith("Worlds "));
  const other = mine.filter((g) => !g.league.startsWith("Worlds ")).slice(0, recent);
  return [...worlds, ...other].sort((a, b) => b.date.localeCompare(a.date));
}

export function buildTeams(codes: string[], series: SeriesResult[], games: GameSummary[], recent = 20): Record<string, TeamAggregate> {
  const homes = homeLeagues(series);
  return Object.fromEntries(codes.map((c) => [c, aggregateTeam(c, series, sampleGames(c, games, recent), homes)]));
}

// ---------- digest ----------

const k = (gold: number) => `${gold < 0 ? "-" : "+"}${(Math.abs(gold) / 1000).toFixed(1)}k`;
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const clock = (min: number) => {
  const sec = Math.round(min * 60);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
const CHAMPION_NAMES: Record<string, string> = {
  MonkeyKing: "Wukong", KSante: "K'Sante", Belveth: "Bel'Veth", Chogath: "Cho'Gath", Kaisa: "Kai'Sa", Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw", Velkoz: "Vel'Koz", RekSai: "Rek'Sai", Leblanc: "LeBlanc", JarvanIV: "Jarvan IV", Nunu: "Nunu",
};
/** Feed champion ids ("MissFortune", "MonkeyKing") as display names. */
export const champ = (c: string) => CHAMPION_NAMES[c] ?? c.replace(/([a-z])([A-Z])/g, "$1 $2");

/** Notable moments involving a team, best first. Each is one short line. */
export function moments(code: string, games: GameSummary[], opponent?: string): string[] {
  const out: { score: number; text: string }[] = [];
  for (const g of games) {
    const sides = [g.blue.code, g.red.code];
    if (!sides.includes(code)) continue;
    const opp = sides[0] === code ? sides[1] : sides[0];
    const bonus = (opp === opponent ? 3 : 0) + (g.league.startsWith("Worlds ") ? 2 : 0) + Date.parse(g.date) / 1e13;
    const tag = `vs ${opp} (${g.league})`;
    if (g.comeback?.team === code) out.push({ score: 5 + g.comeback.deficit / 1000 + bonus, text: `${code} came back from -${(g.comeback.deficit / 1000).toFixed(1)}k at ${clock(g.comeback.min)} ${tag}` });
    if (g.comeback && g.comeback.team === opp) out.push({ score: 5 + g.comeback.deficit / 1000 + bonus, text: `${code} threw a +${(g.comeback.deficit / 1000).toFixed(1)}k lead (${clock(g.comeback.min)}) ${tag}` });
    for (const e of g.events)
      if (e.team === code && e.behind && (e.type === "baron" || e.type === "elder") && e.behind >= 2000)
        out.push({ score: 3 + e.behind / 1000 + bonus, text: `${code} took ${e.type === "baron" ? "Baron" : "Elder"} at ${clock(e.min)} while down ${(e.behind / 1000).toFixed(1)}k ${tag}${g.winner === code ? ", won" : ", lost"}` });
    if (g.swing?.team === code && g.swing.gold >= 5000)
      out.push({ score: 2 + g.swing.gold / 2000 + bonus, text: `${code} swung ${(g.swing.gold / 1000).toFixed(1)}k in ${g.swing.toMin - g.swing.fromMin} min (${clock(g.swing.fromMin)}-${clock(g.swing.toMin)}) ${tag}` });
    if (g.winner === code && g.durationMin < 27) out.push({ score: 2 + (27 - g.durationMin) / 3 + bonus, text: `${code} won in ${clock(g.durationMin)} ${tag}` });
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.text);
}

const FUN_WEIGHT: Record<string, number> = {
  multikill: 4, bigComeback: 7, elderFlip: 6, steal: 5, perfect: 4, roughDay: 4, roughPatch: 3, earlyBlood: 3, cs: 3, wards: 3, damage: 3, peaceful: 2, marathon: 2, stomp: 2,
};

/** Fun facts from both teams' games, best first, each tagged with the opponent and source. */
export function funFactsFor(a: string, b: string, games: GameSummary[]): string[] {
  const out: { score: number; text: string }[] = [];
  for (const g of games) {
    const sides = [g.blue.code, g.red.code];
    if (!sides.includes(a) && !sides.includes(b)) continue;
    const bonus = (sides.includes(a) && sides.includes(b) ? 3 : 0) + (g.league.startsWith("Worlds ") ? 2 : 0) + Date.parse(g.date) / 1e13;
    for (const f of g.funFacts ?? []) {
      if (f.team !== null && f.team !== a && f.team !== b) continue;
      const opp = f.team === null ? null : sides[0] === f.team ? sides[1] : sides[0];
      const extra = f.kind === "multikill" ? (/penta/.test(f.text) ? 6 : /quadra/.test(f.text) ? 4 : 1) : 0;
      out.push({ score: (FUN_WEIGHT[f.kind] ?? 1) + extra + bonus, text: `${f.text} (${opp ? `vs ${opp}` : `${sides[0]} vs ${sides[1]}`}, ${g.league})` });
    }
  }
  return [...new Set(out.sort((x, y) => y.score - x.score).map((x) => x.text))];
}

function teamLines(t: TeamAggregate): string[] {
  const rec = (r: Record2) => `${r.w}-${r.l}`;
  const lines = [
    `${t.code}${t.homeLeague ? ` [${t.homeLeague.replace(/ 2026$/, "")}]` : ""}: 2026 series ${rec(t.season.series)}, games ${rec(t.season.games)} | last ${t.form.length} (newest first) ${t.form}`,
  ];
  const srcs = t.sources.map((s) => `${s.label} ${rec(s.series)}${s.titles ? ` (${s.titles} title${s.titles > 1 ? "s" : ""})` : s.finalsLost ? " (lost final)" : ""}`);
  lines.push(`  ${srcs.join(" · ")}${t.vsInternational.w + t.vsInternational.l ? ` · vs other regions ${rec(t.vsInternational)}` : ""}`);
  const statLine = (label: string, s: TeamStats) =>
    `  ${label} (${s.wins}-${s.games - s.wins}): GD@15 ${s.avgGoldDiff15 === null ? "n/a" : k(s.avgGoldDiff15)}, FB ${pct(s.firstBloodRate)}, FT ${pct(s.firstTowerRate)}, FD ${pct(s.firstDragonRate)}, dragons ${pct(s.dragonShare)}, ${s.avgDurationMin} min avg${s.avgFirstBaronMin !== null ? `, 1st baron ${clock(s.avgFirstBaronMin)}` : ""}`;
  if (t.stats) {
    lines.push(statLine(`Last ${t.stats.games} games`, t.stats));
    lines.push(`  Leads @15 converted ${t.stats.leadAt15.won}/${t.stats.leadAt15.led}, comeback wins ${t.stats.comebackWins}, throws ${t.stats.throws}, objectives taken while 1k+ behind ${t.stats.objectivesWhileBehind}`);
  }
  if (t.worldsStats && t.worldsStats.games !== t.stats?.games) lines.push(statLine(`Worlds 2026 ${t.worldsStats.games} games`, t.worldsStats));
  if (t.stats) {
    const roleTag: Record<Role, string> = { top: "TOP", jungle: "JG", mid: "MID", bottom: "BOT", support: "SUP" };
    lines.push(`  Picks: ${ROLES.map((r) => `${roleTag[r]} ${t.stats!.topChampions[r].map((c) => `${champ(c.champion)} ${c.count}`).join(", ")}`).join(" | ")}`);
    const so = t.stats.standout;
    if (so) lines.push(`  Standout: ${so.name} (${so.role}) KDA ${so.kda} over ${so.games} games${so.damageShare !== null ? `, ${Math.round(so.damageShare * 100)}% dmg share` : ""}`);
  }
  return lines;
}

/** Compact text for an analyst prompt: both teams' 2026 records and stats, head-to-head, and a few telling moments. */
export function digestFor(a: string, b: string, teams: Record<string, TeamAggregate>, series: SeriesResult[], games: GameSummary[]): string {
  const lines = [`Scout: ${a} vs ${b} (official lolesports feeds, 2026 season; GD@15 = gold diff at 15 min, FB/FT/FD = first blood/tower/dragon)`];
  for (const c of [a, b]) {
    const t = teams[c];
    if (!t || t.season.series.w + t.season.series.l === 0) lines.push(`${c}: no 2026 data`);
    else lines.push(...teamLines(t));
  }
  const h2h = headToHead(a, b, series);
  if (h2h.length) {
    const wa = h2h.filter((s) => s.winner === a).length;
    lines.push(`Head-to-head 2026: ${a} ${wa}-${h2h.length - wa} ${b}`);
    for (const s of h2h.slice(0, 3)) lines.push(`  ${s.startTime.slice(0, 10)} ${s.league} ${s.block}: ${s.teamA} ${s.winsA}-${s.winsB} ${s.teamB}`);
  } else lines.push("Head-to-head 2026: none");
  const ms = [...moments(a, games, b).slice(0, 2), ...moments(b, games, a).slice(0, 2)];
  const unique = [...new Set(ms)].slice(0, 4);
  if (unique.length) lines.push("Key moments:", ...unique.map((m) => `  - ${m}`));
  const fun = funFactsFor(a, b, games).slice(0, 2);
  if (fun.length) lines.push("Fun facts:", ...fun.map((f) => `  * ${f}`));
  return lines.slice(0, 30).join("\n");
}
