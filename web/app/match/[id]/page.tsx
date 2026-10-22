// Match page: each analyst's call with what they remembered; after the game the result, the debate and what they learned.
import Link from "next/link";
import { notFound } from "next/navigation";
import { persona } from "../../../lib/personas";
import { art, callsOf, cardFor, lessonText, records, schedule, suiscan, walruscan } from "../../../lib/site";
import { Avatar, RoleIcon, TeamLogo } from "../../ui/bits";
import DitherArt from "../../ui/DitherArt";
import LocalTime from "../../ui/LocalTime";
import MatchCard from "../../ui/MatchCard";

export async function generateStaticParams() {
  const ids = new Set([...records().map((r) => r.series.matchId), ...(await schedule()).filter((s) => s.teamA !== "TBD").map((s) => s.matchId)]);
  return [...ids].map((id) => ({ id }));
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = records().find((x) => x.series.matchId === id);
  const s = r?.series ?? (await schedule()).find((x) => x.matchId === id);
  if (!s) notFound();
  const card = await cardFor(s, r);
  const calls = callsOf(r);
  const result = r?.result ?? null;

  return (
    <main>
      <section className="hero">
        <DitherArt src={art("banner")} className="match-art" band={0.5} />
      </section>
      <div className="wrap">
        <div className="match-head">
          <div className="match-team"><TeamLogo code={s.teamA} logo={card.logoA} />{s.teamA}</div>
          <div style={{ textAlign: "center" }}>
            <div className="eyebrow">{s.block} · Best of {s.bestOf}</div>
            <div className="score-big num">{result ? (result.winner === s.teamA ? result.score : result.score.split("-").reverse().join("-")) : "vs"}</div>
            <div className="muted" style={{ fontSize: 13 }}><LocalTime iso={s.startTime} format="full" /></div>
          </div>
          <div className="match-team"><TeamLogo code={s.teamB} logo={card.logoB} />{s.teamB}</div>
        </div>

        <div className="two section">
          <div className="panel">
            <div className="section-head"><h2>The analysts&apos; calls</h2>{r?.commitDigest && <a className="muted" href={suiscan(r, r.commitDigest)} target="_blank" rel="noreferrer">Locked on Sui before the game ↗</a>}</div>
            {calls.length === 0 && <p className="muted">The analysts pick a few hours before the game. Check back soon.</p>}
            {calls.map((a) => {
              const p = persona(a.player)!;
              const right = result ? a.winner === result.winner : null;
              return (
                <div className="analyst-pick" key={a.player}>
                  <Link href={`/analysts/${p.role}`}><Avatar name={a.name} color={a.color} art={a.art} size={44} result={right === null ? undefined : right ? "right" : "wrong"} /></Link>
                  <div>
                    <div className="ap-name"><RoleIcon role={p.role} /> {a.name} <span className="ap-title">· {a.title}</span></div>
                    <p className="ap-quote">“{a.reasoning}”</p>
                    {a.recalled.length > 0 ? (
                      <details className="recall">
                        <summary>🧠 Recalled {a.recalled.length} lesson{a.recalled.length > 1 ? "s" : ""} from Walrus Memory before picking</summary>
                        <ul>
                          {a.recalled.map((l) => (
                            <li key={l.blobId}><span className="lesson">{lessonText(l.text)}</span> <span className="muted">· saved {new Date(l.createdAt).toISOString().slice(0, 10)}</span> <a className="walrus" href={walruscan(l.blobId)} target="_blank" rel="noreferrer">on Walrus ↗</a></li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <div className="recall muted">No past lessons used for this pick yet.</div>
                    )}
                  </div>
                  <div className={`ap-call ${right === null ? "" : right ? "right" : "wrong"}`}>{a.winner}{a.score ? ` ${a.score}` : ""}<small className="num">{a.prob}% sure</small></div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <MatchCard c={card} />
            {r && (
              <div className="panel">
                <h3 style={{ marginTop: 0 }}>Proof</h3>
                <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Every pick was fingerprinted and locked on Sui before the game. The result is posted on Sui too. Anyone can re-check.</p>
                <div className="proof-links">
                  {r.commitDigest && <a href={suiscan(r, r.commitDigest)} target="_blank" rel="noreferrer">Analysts&apos; picks ↗</a>}
                  {r.fans?.commitDigest && <a href={suiscan(r, r.fans.commitDigest)} target="_blank" rel="noreferrer">Fans&apos; picks ↗</a>}
                  {r.result && <a href={suiscan(r, r.result.resultDigest)} target="_blank" rel="noreferrer">Result ↗</a>}
                  <Link href="/proof">How it works</Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {r?.debate && (
          <section className="section">
            <div className="section-head"><h2>Post-match debate</h2></div>
            <div className="debate panel">
              {r.debate.split("\n").filter(Boolean).map((line, i) => {
                const [who, ...rest] = line.split(":");
                const p = persona(who.trim().toLowerCase());
                return (
                  <div className="bubble" key={i}>
                    {p ? <Avatar name={p.name} color={p.color} art={art(`analyst-${p.role}`)} size={34} /> : null}
                    <p><b>{who.trim()}</b> {rest.join(":").trim()}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {r && r.lessons.length > 0 && (
          <section className="section">
            <div className="section-head"><h2>What they learned</h2><span className="muted">Saved to Walrus Memory, used in future picks</span></div>
            <div className="timeline">
              {r.lessons.map((l) => {
                const p = persona(l.player);
                return (
                  <div className="memory" key={l.player}>
                    <div className="memory-meta"><span className="who">{p && <Avatar name={p.name} color={p.color} art={art(`analyst-${p.role}`)} size={22} />}{p?.name}</span>{l.blobId ? <a className="walrus" href={walruscan(l.blobId)} target="_blank" rel="noreferrer">Saved to Walrus ↗</a> : <span>Saving…</span>}</div>
                    <div className="lesson">{lessonText(l.text)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
