// Scout job: pulls the 2026 season for every Worlds 2026 team from the official lolesports feeds and writes
// data/scout/{series,games,teams,meta}.json. Tier 1: every 2026 series of a Worlds team from the league and
// international schedules. Tier 2: livestats for every Worlds 2026 game plus each team's most recent games elsewhere.
// Requests are sequential with a small delay; raw responses are cached under data/scout/raw/ (gitignored),
// and games already in games.json are never fetched again. Usage: npm run scout [-- [--rebuild] [TEAM_A TEAM_B]]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  type Frame,
  type GameSummary,
  type SeriesResult,
  buildTeams,
  digestFor,
  floor10,
  mergeFrames,
  nextProbe,
  parseDetails,
  parseEvent,
  parseLeagueSeries,
  parseWindow,
  sampleTimes,
  summarizeGame,
  TEAM_ALIASES,
} from "../core/scout.ts";
import { SCOUT_DIR } from "../core/scoutstore.ts";

const API = "https://esports-api.lolesports.com/persisted/gw";
const FEED = "https://feed.lolesports.com/livestats/v1";
const API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"; // public key the lolesports site uses (same as worlds.ts)
const RAW = join(SCOUT_DIR, "raw");
const DELAY_MS = Number(process.env.SCOUT_DELAY_MS ?? 60);
// Seconds of game time between gold samples: every minute at Worlds, every two minutes elsewhere (keeps a full run near an hour).
const STEP_WORLDS = 60;
const STEP_OTHER = Number(process.env.SCOUT_STEP_SEC ?? 120);
const RECENT_GAMES = Number(process.env.SCOUT_RECENT_GAMES ?? 20);
const MAX_PROBES = 12;

// League slug -> label prefix. Leagues without a Worlds team simply contribute nothing.
const LEAGUES: Record<string, string> = {
  worlds: "Worlds",
  msi: "MSI",
  first_stand: "First Stand",
  ewc_lol: "EWC",
  americas_cup: "Americas Cup",
  lck: "LCK",
  lpl: "LPL",
  lec: "LEC",
  lcs: "LCS",
  "cblol-brazil": "CBLOL",
  lcp: "LCP",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

async function getJson(url: string, withKey: boolean): Promise<any | null> {
  for (let attempt = 0; ; attempt++) {
    await sleep(DELAY_MS);
    requests++;
    try {
      const res = await fetch(url, { headers: withKey ? { "x-api-key": API_KEY } : {} });
      if (res.status === 404 || res.status === 204) return null;
      if (res.ok) {
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      }
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status} ${url}`);
      if (attempt >= 5) throw new Error(`HTTP ${res.status} after retries ${url}`);
    } catch (e) {
      if (attempt >= 5 || String(e).includes("HTTP 4")) throw e;
    }
    await sleep(1000 * 2 ** attempt);
  }
}

function readCache(path: string): any | undefined {
  if (!existsSync(path)) return undefined;
  const buf = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8"));
}
function writeCache(path: string, json: any) {
  mkdirSync(dirname(path), { recursive: true });
  const text = JSON.stringify(json);
  writeFileSync(path, path.endsWith(".gz") ? gzipSync(text) : text);
}
async function cached(path: string, url: string, withKey: boolean, keep: (json: any) => boolean = (j) => j !== null): Promise<any | null> {
  const hit = readCache(path);
  if (hit !== undefined) return hit;
  const json = await getJson(url, withKey);
  if (keep(json)) writeCache(path, json);
  return json;
}

async function leagueIds(): Promise<Record<string, string>> {
  const json = await getJson(`${API}/getLeagues?hl=en-US`, true);
  const ids: Record<string, string> = {};
  for (const l of json?.data?.leagues ?? []) if (LEAGUES[l.slug]) ids[l.slug] = l.id;
  return ids;
}

async function scheduleOf(leagueId: string): Promise<any[]> {
  const events: any[] = [];
  let page: string | undefined;
  for (;;) {
    const json = await getJson(`${API}/getSchedule?hl=en-US&leagueId=${leagueId}${page ? `&pageToken=${page}` : ""}`, true);
    const sched = json?.data?.schedule;
    const evs: any[] = sched?.events ?? [];
    events.push(...evs);
    if (!evs.length || evs.some((e) => e.startTime < "2026") || !sched?.pages?.older) break;
    page = sched.pages.older;
  }
  return events;
}

async function gameFrames(gameId: string, stepSec: number): Promise<{ meta: ReturnType<typeof parseWindow>["meta"]; frames: Frame[]; details: any } | null> {
  const dir = join(RAW, "games", gameId);
  const win = (t: string | null) =>
    cached(join(dir, `window-${t ? t.replace(/:/g, "") : "first"}.json.gz`), `${FEED}/window/${gameId}${t ? `?startingTime=${t}` : ""}`, false);
  const first = parseWindow(await win(null));
  if (!first.meta || !first.frames.length) return null;
  const t0 = first.frames[0].ts;
  const endAt = floor10(Math.min(Date.parse(t0) + 3 * 3600_000, Date.now() - 60_000));
  const endPath = join(dir, `window-end.json.gz`);
  const endJson = await cached(endPath, `${FEED}/window/${gameId}?startingTime=${endAt}`, false, (j) => j?.frames?.at(-1)?.gameState === "finished");
  const end = parseWindow(endJson);
  const last = end.frames.at(-1);
  if (!last || last.state !== "finished") return null;
  let frames = mergeFrames(first.frames, end.frames);
  for (const t of sampleTimes(t0, last.ts, stepSec)) frames = mergeFrames(frames, parseWindow(await win(t)).frames);
  for (let i = 0; i < MAX_PROBES; i++) {
    const probe = nextProbe(frames, ["kills", "towers", "dragons"]);
    if (!probe) break;
    const before = frames.length;
    frames = mergeFrames(frames, parseWindow(await win(probe)).frames);
    if (frames.length === before) break;
  }
  const details = await cached(join(dir, "details-end.json.gz"), `${FEED}/details/${gameId}?startingTime=${endAt}`, false);
  return { meta: first.meta, frames, details };
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}
function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 1) + "\n");
}

// ---------- Tier 1: schedules ----------
const ids = await leagueIds();
const series: SeriesResult[] = [];
const allPerLeague: Record<string, number> = {};
let worldsTeams: string[] = [];
for (const [slug, prefix] of Object.entries(LEAGUES)) {
  if (!ids[slug]) {
    console.warn(`league ${slug} not found in getLeagues`);
    continue;
  }
  const label = `${prefix} 2026`;
  const json = { data: { schedule: { events: await scheduleOf(ids[slug]) } } };
  if (slug === "worlds")
    worldsTeams = [...new Set(json.data.schedule.events.filter((e: any) => e.startTime?.startsWith("2026")).flatMap((e: any) => e.match?.teams ?? []).map((t: any) => TEAM_ALIASES[t.code] ?? t.code))].filter(
      (c): c is string => typeof c === "string" && c !== "TBD",
    );
  const parsed = parseLeagueSeries(json, label);
  allPerLeague[label] = parsed.length;
  series.push(...parsed);
  console.log(`${label}: ${parsed.length} completed 2026 series`);
}
const worlds = new Set(worldsTeams);
const unique = new Map<string, SeriesResult>();
for (const s of series) if (worlds.has(s.teamA) || worlds.has(s.teamB)) unique.set(s.matchId, s);
const relevant = [...unique.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
writeJson(join(SCOUT_DIR, "series.json"), relevant);
console.log(`${worldsTeams.length} Worlds teams: ${worldsTeams.sort().join(" ")}; ${relevant.length} series involve them`);

// ---------- Tier 2: livestats ----------
const selected = new Set<string>(relevant.filter((s) => s.league.startsWith("Worlds ")).map((s) => s.matchId));
for (const team of worldsTeams) {
  let n = 0;
  for (const s of [...relevant].reverse()) {
    if (n >= RECENT_GAMES) break;
    if (s.league.startsWith("Worlds ") || (s.teamA !== team && s.teamB !== team)) continue;
    selected.add(s.matchId);
    n += (s.winsA ?? 0) + (s.winsB ?? 0);
  }
}
const gamesPath = join(SCOUT_DIR, "games.json");
// --rebuild re-summarises every game from the raw cache (after a parsing change) instead of reusing games.json.
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const rebuild = process.argv.includes("--rebuild");
const games = new Map<string, GameSummary>(rebuild ? [] : readJson<GameSummary[]>(gamesPath, []).map((g) => [g.gameId, g]));
const missing: string[] = [];
const mismatches: string[] = [];
const save = () => writeJson(gamesPath, [...games.values()].sort((a, b) => a.date.localeCompare(b.date) || a.gameId.localeCompare(b.gameId)));
const todo = relevant.filter((s) => selected.has(s.matchId));
console.log(`livestats: ${todo.length} series selected, ${games.size} games already summarised`);
let done = 0;
for (const s of todo) {
  done++;
  const ev = parseEvent(await cached(join(RAW, "events", `${s.matchId}.json`), `${API}/getEventDetails?hl=en-US&id=${s.matchId}`, true));
  const codes = Object.fromEntries(ev.teams.map((t) => [t.id, t.code]));
  let fetched = 0;
  for (const g of ev.games.filter((x) => x.state === "completed")) {
    if (games.has(g.id)) continue;
    const raw = await gameFrames(g.id, s.league.startsWith("Worlds ") ? STEP_WORLDS : STEP_OTHER);
    if (!raw?.meta) {
      missing.push(`${s.league} ${s.teamA}-${s.teamB} game ${g.number} (${g.id})`);
      continue;
    }
    games.set(g.id, summarizeGame({ meta: raw.meta, frames: raw.frames, details: parseDetails(raw.details), teams: codes, league: s.league, number: g.number, winnerHint: null }));
    fetched++;
  }
  // The per-game winner comes from the final frame; check it adds up to the official series score.
  const mine = [...games.values()].filter((g) => g.matchId === s.matchId);
  const wa = mine.filter((g) => g.winner === s.teamA).length;
  const wb = mine.filter((g) => g.winner === s.teamB).length;
  if (mine.length === (s.winsA ?? 0) + (s.winsB ?? 0) && (wa !== s.winsA || wb !== s.winsB))
    mismatches.push(`${s.league} ${s.teamA} ${s.winsA}-${s.winsB} ${s.teamB}: frames say ${wa}-${wb}`);
  if (fetched) {
    save();
    console.log(`[${done}/${todo.length}] ${s.startTime.slice(0, 10)} ${s.league} ${s.teamA}-${s.teamB}: +${fetched} games (${requests} requests so far)`);
  }
}
save();

// ---------- aggregates ----------
const allGames = [...games.values()];
const teams = buildTeams(worldsTeams, relevant, allGames, RECENT_GAMES);
writeJson(join(SCOUT_DIR, "teams.json"), teams);
const perLeague: Record<string, { series: number; seriesAll: number; games: number }> = {};
for (const [label, n] of Object.entries(allPerLeague)) perLeague[label] = { series: relevant.filter((s) => s.league === label).length, seriesAll: n, games: allGames.filter((g) => g.league === label).length };
writeJson(join(SCOUT_DIR, "meta.json"), { generatedAt: new Date().toISOString(), source: "lolesports official feeds (esports-api getSchedule/getEventDetails, feed livestats window/details)", worldsTeams, perLeague, missing, winnerMismatches: mismatches });
console.log(JSON.stringify(perLeague, null, 1));
if (missing.length) console.log(`no livestats for ${missing.length} games:\n  ${missing.join("\n  ")}`);
if (mismatches.length) console.log(`winner mismatches:\n  ${mismatches.join("\n  ")}`);
console.log(`${requests} requests. Sample digest:\n`);
const [a, b] = args.length === 2 ? args : ["GEN", "IG"];
console.log(digestFor(a, b, teams, relevant, allGames));
