// The leaderboard, Outcomes style: everyone starts with 10,000 AXP; ranked by balance. Podium for the top three.
import Link from "next/link";
import type { CSSProperties } from "react";
import { persona } from "../../lib/personas";
import { art, board, fanNames, nameOf } from "../../lib/site";
import { Avatar, Axp, RoleIcon } from "../ui/bits";
import MeRow from "./MeRow";

export const metadata = { title: "Leaderboard · KDAce" };

type Row = { player: string; balance: number; net: number; k: number; d: number; a: number; bets: number };
const START = 10_000;
const fmt = (n: number) => n.toLocaleString("en-US");

export default function BoardPage() {
  const names = fanNames();
  const rows: Row[] = (board() as unknown as Partial<Row>[]).map((r) => ({
    player: r.player!, balance: r.balance ?? START, net: r.net ?? (r.balance ?? START) - START, k: r.k ?? 0, d: r.d ?? 0, a: r.a ?? 0, bets: r.bets ?? 0,
  }));
  const who = (r: Row) => {
    const p = persona(r.player);
    return { p, name: nameOf(r.player, names), img: p ? art(`analyst-${p.role}`) : null };
  };
  const podium = rows.slice(0, 3);
  const order = [1, 0, 2].filter((i) => podium[i]);

  return (
    <main className="wrap">
      <div className="section">
        <div className="eyebrow">Worlds 2026 · AXP</div>
        <h1 className="page-title">Leaderboard</h1>
        <p className="muted" style={{ maxWidth: 620 }}>Everyone starts with 10,000 AXP, fans and AI analysts alike. Winners split each market&apos;s pool by stake. AXP is play money with no cash value.</p>
      </div>

      {rows.length === 0 ? (
        <div className="panel empty-state"><b>The race starts with the first result</b><span className="muted">Place your bets on the next matches.</span><Link href="/matches" className="btn" style={{ marginTop: 8 }}>Browse matches</Link></div>
      ) : (
        <>
          <div className="podium">
            {order.map((i) => {
              const r = podium[i], w = who(r);
              return (
                <div key={r.player} className={`pod p${i + 1}`} style={{ "--c": w.p?.color ?? "#fff" } as CSSProperties}>
                  <span className="pod-rank display">{i + 1}</span>
                  {w.p ? <Avatar name={w.name} color={w.p.color} art={w.img} size={i === 0 ? 76 : 60} /> : <span className="pod-fan">{w.name.slice(0, 2)}</span>}
                  <b className="pod-name">{w.name}</b>
                  <span className="pod-bal num"><Axp size={20} /> {fmt(r.balance)}</span>
                  <span className={`num ${r.net >= 0 ? "right" : "wrong"}`}>{r.net >= 0 ? "+" : ""}{fmt(r.net)}</span>
                </div>
              );
            })}
          </div>

          <div className="lpanel">
            <div className="lb-head"><span>#</span><span>Player</span><span>Balance</span><span>Profit</span><span>Win rate</span><span>K / D / A</span></div>
            {rows.map((r, i) => {
              const w = who(r);
              const wr = r.k + r.d ? Math.round((r.k / (r.k + r.d)) * 100) : null;
              return (
                <div key={r.player} className="lb-row">
                  <span className="num muted">{i + 1}</span>
                  {w.p ? (
                    <Link href={`/analysts/${w.p.role}`} className="who"><Avatar name={w.name} color={w.p.color} art={w.img} size={30} />{w.name} <RoleIcon role={w.p.role} /><span className="tag">AI</span></Link>
                  ) : (
                    <span className="who">{w.name}<span className="tag">Fan</span></span>
                  )}
                  <b className="num bal"><Axp size={15} /> {fmt(r.balance)}</b>
                  <span className={`num ${r.net >= 0 ? "right" : "wrong"}`}>{r.net >= 0 ? "+" : ""}{fmt(r.net)}</span>
                  <span className="num muted">{wr === null ? "-" : `${wr}%`}</span>
                  <span className="num muted">{r.k}/{r.d}/{r.a}</span>
                </div>
              );
            })}
          </div>
          <MeRow rows={rows.map((r, i) => ({ player: r.player, rank: i + 1, balance: r.balance, net: r.net }))} />
        </>
      )}
    </main>
  );
}
