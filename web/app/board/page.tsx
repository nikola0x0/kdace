// The board: analysts and fans together, ranked by AXP balance, with their KDA.
import Link from "next/link";
import { persona } from "../../lib/personas";
import { art, board, fanNames, nameOf } from "../../lib/site";
import { Avatar, RoleIcon } from "../ui/bits";

export const metadata = { title: "Board · KDAce" };

export default function BoardPage() {
  const rows = board();
  const names = fanNames();
  return (
    <main className="wrap">
      <div className="section">
        <div className="eyebrow">Worlds 2026</div>
        <h1 className="page-title">The board</h1>
        <p className="muted" style={{ maxWidth: 620 }}>Each market has a 1,000-point pot, split between everyone who called it right. K / D / A = correct calls / wrong calls / correct calls you shared with others.</p>
      </div>
      <div className="panel">
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No results yet. The board fills in after the first series is settled.</p>
        ) : (
          <table className="table">
            <thead><tr><th>#</th><th>Player</th><th style={{ textAlign: "right" }}>AXP</th><th style={{ textAlign: "right" }}>K / D / A</th></tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const p = persona(r.player);
                return (
                  <tr key={r.player}>
                    <td className="num muted">{i + 1}</td>
                    <td>
                      {p ? (
                        <Link href={`/analysts/${p.role}`} className="who"><Avatar name={p.name} color={p.color} art={art(`analyst-${p.role}`)} size={30} />{p.name} <RoleIcon role={p.role} /><span className="tag">AI</span></Link>
                      ) : (
                        <span className="who">{nameOf(r.player, names)}<span className="tag">Fan</span></span>
                      )}
                    </td>
                    <td className="num" style={{ textAlign: "right" }}><b>{r.balance.toLocaleString("en-US")}</b></td>
                    <td className="num muted" style={{ textAlign: "right" }}>{r.k} / {r.d} / {r.a}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
