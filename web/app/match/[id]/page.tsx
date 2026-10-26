// Match page: each analyst's call with what they remembered; after the game the result, the debate and what they learned.
import Link from "next/link";
import { notFound } from "next/navigation";
import { persona, shortName } from "../../../lib/personas";
import { art, callsOf, cardFor, lessonText, records, schedule, suiscan, verifyInput, walruscan } from "../../../lib/site";
import { loadRecords } from "../../../lib/data";
import VerifyButton from "../../ui/VerifyButton";
import { Avatar, RoleIcon, TeamLogo } from "../../ui/bits";
import DitherArt from "../../ui/DitherArt";
import HeroVeil from "../../ui/HeroVeil";
import TrashTalk from "../../ui/TrashTalk";
import CountUp from "../../ui/rb/CountUp";
import LocalTime from "../../ui/LocalTime";
import MatchActivity from "../../ui/MatchActivity";
import MatchCard from "../../ui/MatchCard";

// Rendered per request: records are read live (Supabase), so these pages are never prebuilt.
export const dynamic = "force-dynamic";


const pill = "inline-flex h-9 items-center rounded-full border border-input px-3.5 text-sm text-muted-foreground transition-colors hover:border-neutral-500 hover:text-foreground";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  await loadRecords();
  const { id } = await params;
  const r = records().find((x) => x.series.matchId === id);
  const s = r?.series ?? (await schedule()).find((x) => x.matchId === id);
  if (!s) notFound();
  const card = await cardFor(s, r);
  const calls = callsOf(r);
  const isVoid = r?.status === "void";
  const result = isVoid ? null : r?.result ?? null;
  const matchArt = art("match-banner") ?? art("hero-trophy");

  return (
    <main>
      <section className="hero">
        <div className="match-veil">{matchArt ? <HeroVeil src={matchArt} fit="cover" radius={260} /> : <DitherArt className="match-art" />}</div>
      </section>
      <div className="wrap">
        <div className="match-head">
          <div className="match-team"><TeamLogo code={s.teamA} logo={card.logoA} />{s.teamA}</div>
          <div style={{ textAlign: "center" }}>
            <div className="eyebrow">{s.block} · Best of {s.bestOf}</div>
            <div className="score-big num">{isVoid ? "VOID" : result ? (result.winner === s.teamA ? result.score : result.score.split("-").reverse().join("-")) : "vs"}</div>
            {isVoid && <div className="muted" style={{ fontSize: 13 }}>Void · refunded: no official result, every stake returned</div>}
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
                    {a.topUp && <p className="m-0 mb-2 text-sm text-muted-foreground">💰 {a.name} added <b className="num text-foreground">{a.topUp.add.toLocaleString("en-US")} AXP</b> on {a.winner} at the final call{a.topUp.reasoning ? <>: “{a.topUp.reasoning}”</> : null}</p>}
                    {a.thinking && (
                      <details className="recall">
                        <summary>💭 How {shortName(persona(a.player)!)} thought it through</summary>
                        <p className="m-0 mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{a.thinking}</p>
                      </details>
                    )}
                    {a.recalled.length > 0 ? (
                      <details className="recall">
                        <summary>🧠 Recalled {a.recalled.length} lesson{a.recalled.length > 1 ? "s" : ""} from Walrus Memory before picking</summary>
                        <ul>
                          {a.recalled.map((l) => (
                            <li key={l.blobId}><span className="lesson">{lessonText(l.text)}</span> <span className="muted">· saved <LocalTime iso={l.createdAt} format="date" /></span> <a className="walrus" href={walruscan(l.blobId)} target="_blank" rel="noreferrer">on Walrus ↗</a></li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                  <div className={`ap-call ${right === null ? "" : right ? "right" : "wrong"}`}>{a.winner}{a.score ? ` ${a.score}` : ""}<small className="num"><CountUp to={a.prob} duration={1.2} />% sure</small></div>
                </div>
              );
            })}
            {r?.banter && <TrashTalk banter={r.banter} picks={Object.fromEntries(r.picks.map((x) => [x.player, x.winner]))} />}
          </div>

          <div style={{ display: "grid", gap: 20 }}>
            <MatchCard c={card} onPage />
            <MatchActivity matchId={s.matchId} />
            {r && (
              <div className="panel grid gap-3">
                <h3 className="m-0 text-base font-bold">Proof</h3>
                <p className="m-0 text-sm leading-relaxed text-muted-foreground">Every pick was fingerprinted and locked on Sui before the game. The result is posted on Sui too. Anyone can re-check.</p>
                <div className="flex flex-wrap items-center gap-2">
                  {r.commitDigest && <VerifyButton input={verifyInput(r)} title={`${s.teamA} vs ${s.teamB}`} />}
                  {r.commitDigest && <a className={pill} href={suiscan(r, r.commitDigest)} target="_blank" rel="noreferrer">Analysts&apos; picks ↗</a>}
                  {r.finalCall?.status === "committed" && <a className={pill} href={suiscan(r.finalCall, r.finalCall.commitDigest)} target="_blank" rel="noreferrer">Final call ↗</a>}
                  {r.fans?.commitDigest && <a className={pill} href={suiscan(r, r.fans.commitDigest)} target="_blank" rel="noreferrer">Fans&apos; picks ↗</a>}
                  {r.result && <a className={pill} href={suiscan(r, r.result.resultDigest)} target="_blank" rel="noreferrer">{isVoid ? "Void result ↗" : "Result ↗"}</a>}
                  <Link className={`${pill} border-transparent px-2 hover:border-transparent`} href="/proof">How it works →</Link>
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
