// Worlds 2026 schedule and results from the public lolesports API.

export type SeriesState = "unstarted" | "inProgress" | "completed";

export type Series = {
  matchId: string;
  startTime: string;
  block: string;
  bestOf: 1 | 3 | 5;
  state: SeriesState;
  teamA: string;
  teamB: string;
  winsA: number | null;
  winsB: number | null;
  winner: string | null;
};

const SCHEDULE_URL = "https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&leagueId=98767975604431411";
const API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z";

export function parseSchedule(json: any): Series[] {
  const events: any[] = json?.data?.schedule?.events ?? [];
  return events
    .filter((e) => typeof e.startTime === "string" && e.startTime.startsWith("2026") && e.match)
    .map((e) => {
      const [a, b] = e.match.teams;
      const outcome = (t: any) => t?.result?.outcome;
      return {
        matchId: e.match.id,
        startTime: e.startTime,
        block: e.blockName,
        bestOf: e.match.strategy.count,
        state: e.state,
        teamA: a.code,
        teamB: b.code,
        winsA: a.result?.gameWins ?? null,
        winsB: b.result?.gameWins ?? null,
        winner: outcome(a) === "win" ? a.code : outcome(b) === "win" ? b.code : null,
      };
    });
}

export async function fetchSeries(): Promise<Series[]> {
  const res = await fetch(SCHEDULE_URL, { headers: { "x-api-key": API_KEY } });
  if (!res.ok) throw new Error(`lolesports schedule HTTP ${res.status}`);
  return parseSchedule(await res.json());
}
