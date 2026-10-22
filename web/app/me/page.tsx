// My picks: a signed-in fan's calls and how they went.
import { records, schedule } from "../../lib/site";
import MyPicks from "./MyPicks";

export const metadata = { title: "My picks · KDAce" };

export default async function MePage() {
  const recs = records();
  const matches: Record<string, { label: string; start: string; result: { winner: string; score: string } | null; fansDigest: string | null; network: string }> = {};
  for (const s of await schedule()) matches[s.matchId] = { label: `${s.teamA} vs ${s.teamB} · ${s.block}`, start: s.startTime, result: null, fansDigest: null, network: "testnet" };
  for (const r of recs)
    matches[r.series.matchId] = {
      label: `${r.series.teamA} vs ${r.series.teamB} · ${r.series.block}`,
      start: r.series.startTime,
      result: r.result ? { winner: r.result.winner, score: r.result.score } : null,
      fansDigest: r.fans?.commitDigest ?? null,
      network: r.fans?.chain.network ?? r.chain?.network ?? "testnet",
    };
  return (
    <main className="wrap">
      <div className="section">
        <div className="eyebrow">Your record</div>
        <h1 className="page-title">My picks</h1>
      </div>
      <MyPicks matches={matches} />
    </main>
  );
}
