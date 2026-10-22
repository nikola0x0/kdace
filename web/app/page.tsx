// Home: today's and upcoming matches first, then recent results and the top of the board.
import Link from "next/link";
import { PERSONAS, persona } from "../lib/personas";
import { art, board, counters, fanNames, nameOf, settledCards, teamLogos, upcomingCards } from "../lib/site";
import { Avatar } from "./ui/bits";
import DitherArt from "./ui/DitherArt";
import HeroVeil from "./ui/HeroVeil";
import TeamStrip from "./ui/TeamStrip";
import CountUp from "./ui/rb/CountUp";
import DecryptedText from "./ui/rb/DecryptedText";
import LocalTime from "./ui/LocalTime";
import MatchCard from "./ui/MatchCard";

export default async function Home() {
  const [upcoming, settled] = await Promise.all([upcomingCards(), settledCards()]);
  const stats = counters();
  const logos = await teamLogos();
  const banner = art("hero-trophy") ?? art("banner");
  const rows = board().slice(0, 5);
  const names = fanNames();
  // The next slate: everything starting within 20 hours of the first upcoming series (one match day in any timezone).
  const first = upcoming[0] ? Date.parse(upcoming[0].series.startTime) : 0;
  const firstGroup = upcoming.filter((c) => Date.parse(c.series.startTime) - first < 20 * 3600_000);
  const rest = upcoming.filter((c) => !firstGroup.includes(c));
  const isToday = firstGroup[0] && Date.parse(firstGroup[0].series.startTime) - Date.now() < 12 * 3600_000;

  return (
    <main>
      <section className="hero hero-split">
        <div className="wrap hero-grid">
          <div className="hero-text">
            <div className="eyebrow">Worlds 2026 · Free to play</div>
            <h1><DecryptedText text="Who reads Worlds best?" animateOn="view" sequential revealDirection="start" speed={45} characters="KDACE01#$%&@!?" /></h1>
            <p>Call every match against five AI analysts. Their picks are locked on Sui before the game, and after every series they learn from it in Walrus Memory.</p>
            <div className="stats">
              <span className="stat"><b className="num"><CountUp to={stats.memories} duration={1.6} /></b> memories saved to Walrus</span>
              <span className="stat"><b className="num"><CountUp to={stats.committed} duration={1.6} /></b> series locked on Sui</span>
              <span className="stat"><b className="num"><CountUp to={stats.settled} duration={1.6} /></b> settled</span>
            </div>
          </div>
          <div className="hero-visual">
            {banner ? <HeroVeil src={banner} /> : <DitherArt palette="hero" />}
          </div>
        </div>
      </section>

      <TeamStrip logos={Object.entries(logos).map(([code, src]) => ({ code, src }))} />

      <div className="wrap">
        <section className="section">
          <div className="section-head">
            <h2>{isToday ? "Today" : firstGroup[0] ? <>Next up · <LocalTime iso={firstGroup[0].series.startTime} format="day" /></> : "Upcoming"}</h2>
            <Link href="/proof">How picks are proven →</Link>
          </div>
          {firstGroup.length ? (
            <div className="grid">{firstGroup.map((c) => <MatchCard key={c.series.matchId} c={c} />)}</div>
          ) : (
            <p className="muted">No matches scheduled right now. The next stage appears here as soon as teams are set.</p>
          )}
        </section>

        {rest.length > 0 && (
          <section className="section">
            <div className="section-head"><h2>Upcoming</h2></div>
            <div className="grid">{rest.map((c) => <MatchCard key={c.series.matchId} c={c} />)}</div>
          </section>
        )}

        <section className="section two">
          <div>
            <div className="section-head"><h2>Recent results</h2></div>
            {settled.length ? (
              <div className="grid">{settled.slice(0, 4).map((c) => <MatchCard key={c.series.matchId} c={c} />)}</div>
            ) : (
              <p className="muted">Results land here after each series, with the analysts&apos; debate and what they learned.</p>
            )}
          </div>
          <div>
            <div className="section-head"><h2>Board</h2><Link href="/board">Full board →</Link></div>
            <div className="panel">
              {rows.length ? (
                <table className="table">
                  <tbody>
                    {rows.map((r, i) => {
                      const p = persona(r.player);
                      return (
                        <tr key={r.player}>
                          <td className="num muted">{i + 1}</td>
                          <td><span className="who">{p ? <Avatar name={p.name} color={p.color} art={art(`analyst-${p.role}`)} size={26} /> : null}{nameOf(r.player, names)}</span></td>
                          <td className="num" style={{ textAlign: "right" }}><b>{r.balance.toLocaleString("en-US")}</b></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>The race starts with the first result. Meet the analysts:</p>
                  <div style={{ display: "grid", gap: 10 }}>
                    {PERSONAS.map((p) => (
                      <Link key={p.role} href={`/analysts/${p.role}`} className="who">
                        <Avatar name={p.name} color={p.color} art={art(`analyst-${p.role}`)} size={30} />
                        <span>{p.name} <span className="muted" style={{ fontWeight: 500 }}>· {p.title}</span></span>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
