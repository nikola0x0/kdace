// My matches: a signed-in fan's record, upcoming picks and history.
import { board, records, schedule, teamLogos } from "../../lib/site";
import MyPicks, { type MyMatch } from "./MyPicks";

export const metadata = { title: "My matches · KDAce" };

export default async function MePage() {
  const logos = await teamLogos();
  const matches: Record<string, MyMatch> = {};
  const base = (s: { matchId: string; teamA: string; teamB: string; block: string; bestOf: 1 | 3 | 5; startTime: string }): MyMatch => ({
    matchId: s.matchId, teamA: s.teamA, teamB: s.teamB, block: s.block, bestOf: s.bestOf, start: s.startTime,
    logoA: logos[s.teamA] ?? null, logoB: logos[s.teamB] ?? null, result: null, points: {}, fansLocked: false,
  });
  for (const s of await schedule()) matches[s.matchId] = base(s);
  for (const r of records())
    matches[r.series.matchId] = {
      ...base(r.series),
      result: r.result ? { winner: r.result.winner, score: r.result.score } : null,
      points: Object.fromEntries(Object.entries(r.points ?? {}).filter(([k]) => k.startsWith("fan:"))),
      fansLocked: !!r.fans?.commitDigest,
    };
  const rows = board();
  return (
    <main className="wrap">
      <div className="section">
        <div className="eyebrow">Your record</div>
        <h1 className="page-title">My matches</h1>
      </div>
      <MyPicks matches={matches} board={rows.map((r, i) => ({ player: r.player, rank: i + 1, points: r.points, k: r.k, d: r.d, a: r.a }))} />
    </main>
  );
}
