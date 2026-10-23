// The five analysts as tall character banners side by side, each with their record. Hover widens a banner.
import Link from "next/link";
import type { CSSProperties } from "react";
import { PERSONAS, shortName } from "../../lib/personas";
import { analystStats, art } from "../../lib/site";
import { loadRecords } from "../../lib/data";
import { Axp, RoleIcon } from "../ui/bits";

export const metadata = { title: "Analysts · KDAce" };

export default async function AnalystsPage() {
  await loadRecords();
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
            <div className="banner-art" style={img ? { backgroundImage: `url(${img})` } : undefined}>{!img && <span>{p.name.split(" ").pop()!.slice(0, 1)}</span>}</div>
            <div className="banner-shade" />
            <div className="banner-top"><RoleIcon role={p.role} size={18} /><span>{p.role.toUpperCase()}</span></div>
            <div className="banner-info">
              <div className="banner-title">{p.title}</div>
              <div className="banner-name display">{shortName(p)}</div>
              <div className="banner-bal">
                <b className="num bal" title="Balance: AXP free to bet"><Axp size={22} /> {s.balance.toLocaleString("en-US")}</b>
                {s.inPlay > 0 && <span className="num muted" title="AXP in open bets">+{s.inPlay.toLocaleString("en-US")} in play</span>}
                {s.net !== 0 && <span className={`num ${s.net > 0 ? "right" : "wrong"}`}>{s.net > 0 ? "+" : ""}{s.net.toLocaleString("en-US")}</span>}
              </div>
              <div className="banner-more">
                <div className="stat-strip">
                  <div><b className="num">{s.accuracy === null ? "-" : `${s.accuracy}%`}</b><span>Win rate</span></div>
                  <div><b className="num">{s.correct}–{s.settled - s.correct}</b><span>Record</span></div>
                  <div><b className="num">{s.memories}</b><span>Memories</span></div>
                </div>
                {s.form.length > 0 && <div className="banner-form">{s.form.map((r, i) => <i key={i} className={r === "W" ? "w" : "l"}>{r}</i>)}</div>}
                <p className="banner-quote">{p.personality}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
