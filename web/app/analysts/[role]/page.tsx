// One analyst: portrait, personality, record, and their memory timeline on Walrus.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ANALYSTS } from "../../../../src/core/analysts.ts";
import { PERSONAS, persona } from "../../../lib/personas";
import { art, board, lessonText, records, walruscan } from "../../../lib/site";
import { RoleIcon } from "../../ui/bits";

export const generateStaticParams = () => PERSONAS.map((p) => ({ role: p.role }));

export default async function AnalystPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  const p = persona(role);
  if (!p) notFound();
  const belief = ANALYSTS.find((a) => a.player === p.player)!.belief;
  const row = board().find((r) => r.player === p.player);
  const all = records();
  const memories = all
    .flatMap((r) => r.lessons.filter((l) => l.player === p.player && l.blobId).map((l) => ({ ...l, series: r.series })))
    .reverse();
  const uses = new Map<string, number>();
  for (const r of all) for (const pick of r.picks) if (pick.player === p.player) for (const l of pick.usedLessons ?? []) uses.set(l.blobId, (uses.get(l.blobId) ?? 0) + 1);
  const picks = all.filter((r) => r.picks.some((x) => x.player === p.player)).reverse().slice(0, 8);
  const portrait = art(`analyst-${p.role}`);

  return (
    <main className="wrap">
      <div className="profile">
        <div className="portrait" style={{ background: `radial-gradient(circle at 30% 25%, #ffffff55 0, ${p.color} 65%)` }}>
          {portrait ? <img src={portrait} alt={p.name} /> : p.name.slice(0, 1)}
        </div>
        <div>
          <div className="eyebrow"><RoleIcon role={p.role} /> {p.role.toUpperCase()} · {p.title}</div>
          <h1 className="page-title">{p.name}</h1>
          <p style={{ color: "var(--fg-2)", fontSize: 17, maxWidth: 620 }}>{p.personality}</p>
          <p className="muted" style={{ maxWidth: 620 }}><b style={{ color: "var(--fg)" }}>Believes:</b> {belief}</p>
          <p className="muted"><b style={{ color: "var(--fg)" }}>Meta picks:</b> {p.meta.join(", ")}</p>
          <div className="kpis" style={{ marginTop: 18 }}>
            <div className="kpi"><b className="num">{row?.points ?? 0}</b><span>points</span></div>
            <div className="kpi"><b className="num">{row ? `${row.k} / ${row.d} / ${row.a}` : "0 / 0 / 0"}</b><span>K / D / A</span></div>
            <div className="kpi"><b className="num">{memories.length}</b><span>memories on Walrus</span></div>
            <div className="kpi"><b className="num">{[...uses.values()].reduce((a, b) => a + b, 0)}</b><span>times recalled</span></div>
          </div>
        </div>
      </div>

      <div className="two section">
        <section>
          <div className="section-head"><h2>Memory</h2><span className="muted">Newest first · each one lives in {p.name}&apos;s own Walrus Memory</span></div>
          {memories.length === 0 && <p className="muted">No lessons yet. {p.name} saves one after every settled series.</p>}
          <div className="timeline">
            {memories.map((m) => (
              <div className="memory" key={m.blobId}>
                <div className="memory-meta">
                  <Link href={`/match/${m.series.matchId}`}>{m.series.teamA} vs {m.series.teamB} · {m.series.block}</Link>
                  <span>{uses.get(m.blobId) ? `recalled ${uses.get(m.blobId)}×` : "not recalled yet"} · <a className="walrus" href={walruscan(m.blobId)} target="_blank" rel="noreferrer">Walrus ↗</a></span>
                </div>
                <div className="lesson">{lessonText(m.text)}</div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <div className="section-head"><h2>Recent calls</h2></div>
          <div className="panel">
            {picks.length === 0 && <p className="muted" style={{ margin: 0 }}>No calls yet.</p>}
            {picks.map((r) => {
              const pick = r.picks.find((x) => x.player === p.player)!;
              const right = r.result ? pick.winner === r.result.winner : null;
              return (
                <Link key={r.series.matchId} href={`/match/${r.series.matchId}`} className="call-row">
                  <span>{r.series.teamA} vs {r.series.teamB}</span>
                  <span className={right === null ? "muted" : right ? "right" : "wrong"}>{pick.winner}{pick.score ? ` ${pick.score}` : ""} · <span className="num">{pick.winProbability}%</span>{right === null ? "" : right ? " ✓" : " ✗"}</span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
