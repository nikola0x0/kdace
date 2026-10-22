// The five analysts as tall character banners side by side, each with their record. Hover widens a banner.
import Link from "next/link";
import type { CSSProperties } from "react";
import { PERSONAS } from "../../lib/personas";
import { analystStats, art } from "../../lib/site";
import { RoleIcon } from "../ui/bits";

export const metadata = { title: "Analysts · KDAce" };

export default function AnalystsPage() {
  const crew = PERSONAS.map((p) => ({ p, s: analystStats(p.player), img: art(`analyst-${p.role}`) }));
  return (
    <main className="wrap">
      <div className="section">
        <div className="eyebrow">The crew</div>
        <h1 className="page-title">Five analysts, one per role</h1>
        <p className="muted" style={{ maxWidth: 640 }}>Same data, five beliefs. After every series they argue about it and save one lesson to their own Walrus Memory, which they recall before their next pick.</p>
      </div>
      <div className="banners">
        {crew.map(({ p, s, img }) => (
          <Link key={p.role} href={`/analysts/${p.role}`} className="banner" style={{ "--c": p.color } as CSSProperties}>
            <div className="banner-art" style={img ? { backgroundImage: `url(${img})` } : undefined}>{!img && <span>{p.name.slice(0, 1)}</span>}</div>
            <div className="banner-shade" />
            <div className="banner-top"><RoleIcon role={p.role} size={18} /><span>{p.role.toUpperCase()}</span></div>
            <div className="banner-info">
              <div className="banner-title">{p.title}</div>
              <div className="banner-name display">{p.name}</div>
              <div className="banner-acc"><b className="num">{s.accuracy === null ? "-" : `${s.accuracy}%`}</b><span>accuracy{s.settled ? ` · ${s.correct}/${s.settled}` : ""}</span></div>
              <div className="banner-stats">
                <span><b className="num">{s.balance.toLocaleString("en-US")}</b>AXP</span>
                <span><b className="num">{s.k}/{s.d}/{s.a}</b>KDA</span>
                <span><b className="num">{s.memories}</b>memories</span>
              </div>
              <div className="banner-form">
                {s.form.length ? s.form.map((r, i) => <i key={i} className={r === "W" ? "w" : "l"}>{r}</i>) : <span className="muted">{s.calls} calls · no results yet</span>}
              </div>
              <p className="banner-quote">{p.personality}</p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
