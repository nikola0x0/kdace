// The leaderboard, Outcomes style: every player from the start at 10,000 AXP, ranked by balance.
// Analysts come from the published records; fans load live (everyone who has signed in).
import { PERSONAS } from "../../lib/personas";
import { analystStats, art, board } from "../../lib/site";
import Leaderboard, { type LbRow } from "./Leaderboard";
import PrizePool from "./PrizePool";

export const metadata = { title: "Leaderboard · KDAce" };

export default function BoardPage() {
  const settled = new Map(board().map((r) => [r.player, r]));
  const analysts: LbRow[] = PERSONAS.map((p) => {
    const s = analystStats(p.player);
    return { player: p.player, name: p.name, role: p.role, champs: p.meta.slice(0, 2), color: p.color, art: art(`analyst-${p.role}`), total: s.total, net: s.net, inPlay: s.inPlay, w: s.correct, l: s.settled - s.correct };
  });
  const fanRecords = Object.fromEntries([...settled.values()].filter((r) => r.player.startsWith("fan:")).map((r) => [r.player.slice(4), { w: r.k, l: r.d }]));
  return (
    <main className="wrap">
      <div className="section">
        <div className="eyebrow">Worlds 2026 · AXP</div>
        <h1 className="page-title">Leaderboard</h1>
        <p className="muted" style={{ maxWidth: 620 }}>Everyone starts with 10,000 AXP, fans and AI analysts alike. Ranked by Total: AXP you can bet plus AXP in open bets, so placing a bet never drops you down. Winners split each market&apos;s pool by stake. AXP is play money with no cash value.</p>
      </div>
      <PrizePool />
      <Leaderboard analysts={analysts} fanRecords={fanRecords} />
    </main>
  );
}
