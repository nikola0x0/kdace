// The five analysts: who they are, how they think, and how they're doing.
import Link from "next/link";
import { PERSONAS } from "../../lib/personas";
import { art, board, records } from "../../lib/site";
import { Avatar, RoleIcon } from "../ui/bits";

export const metadata = { title: "Analysts · KDAce" };

export default function AnalystsPage() {
  const rows = board();
  const all = records();
  return (
    <main className="wrap">
      <div className="section">
        <div className="eyebrow">The crew</div>
        <h1 className="page-title">Five analysts, one per role</h1>
        <p className="muted" style={{ maxWidth: 640 }}>Each sees the same data but reads it through their own belief. After every series they argue about it and save one lesson to their own Walrus Memory, which they recall before their next pick.</p>
      </div>
      <div className="grid">
        {PERSONAS.map((p) => {
          const row = rows.find((r) => r.player === p.player);
          const memories = all.reduce((n, r) => n + r.lessons.filter((l) => l.player === p.player && l.blobId).length, 0);
          return (
            <Link key={p.role} href={`/analysts/${p.role}`} className="card analyst-card">
              <div className="card-body">
                <div className="who"><Avatar name={p.name} color={p.color} art={art(`analyst-${p.role}`)} size={56} /><div><div style={{ fontSize: 20 }}>{p.name} <RoleIcon role={p.role} size={18} /></div><div className="ap-title">{p.title}</div></div></div>
                <p className="muted" style={{ margin: 0 }}>{p.personality}</p>
                <div className="kpis">
                  <div className="kpi"><b className="num">{row?.points ?? 0}</b><span>points</span></div>
                  <div className="kpi"><b className="num">{row ? `${row.k}/${row.d}/${row.a}` : "0/0/0"}</b><span>K / D / A</span></div>
                  <div className="kpi"><b className="num">{memories}</b><span>memories</span></div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
