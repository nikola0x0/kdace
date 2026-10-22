// Reads the Scout files written by `npm run scout` (data/scout/*.json) and builds a matchup digest from them.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { digestFor, type GameSummary, type SeriesResult, type TeamAggregate } from "./scout.ts";

export type ScoutData = { series: SeriesResult[]; games: GameSummary[]; teams: Record<string, TeamAggregate> };

export const SCOUT_DIR = "data/scout";

export function loadScout(dir = SCOUT_DIR): ScoutData | null {
  const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  if (!["series.json", "games.json", "teams.json"].every((f) => existsSync(join(dir, f)))) return null;
  return { series: read("series.json"), games: read("games.json"), teams: read("teams.json") };
}

/** The prompt digest for a matchup, or null when Scout data hasn't been generated. */
export function scoutDigest(teamA: string, teamB: string, data: ScoutData | null = loadScout()): string | null {
  return data ? digestFor(teamA, teamB, data.teams, data.series, data.games) : null;
}
