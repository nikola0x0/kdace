// One analyst: portrait banner, personality and record up top; their Walrus memory and recent calls below.
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { ANALYSTS } from "../../../../src/core/analysts.ts";
import { PERSONAS, persona } from "../../../lib/personas";
import { analystStats, art, lessonText, records, teamLogos, titleCallsOf, walruscan } from "../../../lib/site";
import { Axp, RoleIcon, TeamLogo } from "../../ui/bits";

export const generateStaticParams = () => PERSONAS.map((p) => ({ role: p.role }));

export default async function AnalystPage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  const p = persona(role);
  if (!p) notFound();
  const belief = ANALYSTS.find((a) => a.player === p.player)!.belief;
  const s = analystStats(p.player);
  const all = records();
  const memories = all.flatMap((r) => r.lessons.filter((l) => l.player === p.player && l.blobId).map((l) => ({ ...l, series: r.series }))).reverse();
  const uses = new Map<string, number>();
  for (const r of all) for (const pick of r.picks) if (pick.player === p.player) for (const l of pick.usedLessons ?? []) uses.set(l.blobId, (uses.get(l.blobId) ?? 0) + 1);
  const calls = all.filter((r) => r.picks.some((x) => x.player === p.player)).reverse().slice(0, 10);
  const img = art(`analyst-${p.role}`);
  const others = PERSONAS.filter((x) => x.role !== p.role);
  const titleCalls = titleCallsOf(p.player);
  const current = titleCalls.at(-1);
  const logos = current ? await teamLogos() : {};

  return (
    <main className="wrap" style={{ "--c": p.color } as CSSProperties}>
      <section className="ap-hero">
        <div className="banner ap-banner">
          <div className="banner-art" style={img ? { backgroundImage: `url(${img})` } : undefined}>{!img && <span>{p.name.split(" ").pop()!.slice(0, 1)}</span>}</div>
          <div className="banner-shade" />
          <div className="banner-top"><RoleIcon role={p.role} size={18} /><span>{p.role.toUpperCase()}</span></div>
        </div>

        <div className="ap-info">
          <div className="banner-title">{p.title}</div>
          <h1 className="page-title" style={{ margin: "6px 0 12px" }}>{p.name}</h1>
          <p className="ap-lead">{p.personality}</p>

          <div className="ap-kpis">
            <div className="ap-kpi big"><b className="num bal"><Axp size={28} /> {s.balance.toLocaleString("en-US")}</b><span>AXP balance</span></div>
            <div className="ap-kpi"><b className={`num ${s.net > 0 ? "right" : s.net < 0 ? "wrong" : ""}`}>{s.net > 0 ? "+" : ""}{s.net.toLocaleString("en-US")}</b><span>Profit{s.roi === null ? "" : ` · ROI ${s.roi > 0 ? "+" : ""}${s.roi}%`}</span></div>
            <div className="ap-kpi"><b className="num">{s.accuracy === null ? "-" : `${s.accuracy}%`}</b><span>Win rate{s.settled ? ` · ${s.correct}–${s.settled - s.correct}` : ""}</span></div>
            <div className="ap-kpi"><b className="num">{s.inPlay.toLocaleString("en-US")}</b><span>In play</span></div>
            <div className="ap-kpi"><b className="num">{s.memories}</b><span>Memories · {s.recalled} recalled</span></div>
          </div>

          <div className="ap-facts">
            <div><span className="ap-label">Believes</span><p>{belief}</p></div>
            <div><span className="ap-label">Meta picks</span><div className="ap-chips">{p.meta.map((m) => <span key={m} className="tag">{m}</span>)}</div></div>
            {current && (
              <div>
                <span className="ap-label">Wins Worlds</span>
                <p className="flex items-center gap-2 [&_.tlogo]:size-6"><TeamLogo code={current.champion} logo={logos[current.champion] ?? null} /><b>{current.champion}</b><span className="muted">{current.probability}% chance</span></p>
                {titleCalls.length > 1 && (
                  <div className="ap-chips">{titleCalls.slice(-6).map((c) => <span key={c.date} className="tag" title={`${c.probability}%`}>{c.date.slice(5)} {c.champion}</span>)}</div>
                )}
              </div>
            )}
            <div><span className="ap-label">Form</span><div className="banner-form">{s.form.length ? s.form.map((r, i) => <i key={i} className={r === "W" ? "w" : "l"}>{r}</i>) : <span className="muted">No results yet</span>}</div></div>
          </div>
        </div>
      </section>

      <div className="two section">
        <section>
          <div className="section-head stacked">
            <h2>Memory</h2>
            <p className="muted">Lessons {p.name} saved to its own Walrus Memory, newest first.</p>
          </div>
          {memories.length === 0 ? (
            <div className="panel empty-state">
              <b>No lessons yet</b>
              <span className="muted">{p.name} writes one after every settled series, then recalls it before future picks.</span>
            </div>
          ) : (
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
          )}
        </section>

        <section>
          <div className="section-head stacked">
            <h2>Recent calls</h2>
            <p className="muted">Every pick is locked on Sui before the game.</p>
          </div>
          <div className="panel calls">
            {calls.length === 0 && <span className="muted">No calls yet.</span>}
            {calls.map((r) => {
              const pick = r.picks.find((x) => x.player === p.player)!;
              const right = r.result ? pick.winner === r.result.winner : null;
              return (
                <Link key={r.series.matchId} href={`/match/${r.series.matchId}`} className="call">
                  <span className="call-match"><b>{r.series.teamA}</b> <span className="muted">vs</span> <b>{r.series.teamB}</b></span>
                  <span className="call-pick">{pick.winner}{pick.score ? ` ${pick.score}` : ""} <span className="muted num">{pick.winProbability}%</span></span>
                  <span className={`call-res ${right === null ? "" : right ? "w" : "l"}`}>{right === null ? "Pending" : right ? "Right" : "Wrong"}</span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      <section className="section">
        <div className="section-head"><h2>The rest of the crew</h2></div>
        <div className="crew-row">
          {others.map((o) => (
            <Link key={o.role} href={`/analysts/${o.role}`} className="crew-chip" style={{ "--c": o.color } as CSSProperties}>
              <span className="crew-img" style={art(`analyst-${o.role}`) ? { backgroundImage: `url(${art(`analyst-${o.role}`)})` } : undefined} />
              <span><b>{o.name}</b><small>{o.title}</small></span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
