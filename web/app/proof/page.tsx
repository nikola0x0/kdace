// Proof: the verification chain at a glance, the numbers, and every on-chain link.
import Link from "next/link";
import { persona } from "../../lib/personas";
import { lessonText, picksLocked, records, suiscan, verifyInput, walruscan } from "../../lib/site";
import { loadRecords } from "../../lib/data";
import VerifyButton from "../ui/VerifyButton";

export const metadata = { title: "Proof · KDAce" };

const STEPS = [
  { k: "01", t: "Pick", d: "Analysts and fans choose" },
  { k: "02", t: "Fingerprint", d: "All picks hashed together" },
  { k: "03", t: "Locked on Sui", d: "Before the game starts" },
  { k: "04", t: "Result on Sui", d: "Official score posted" },
  { k: "05", t: "Lesson on Walrus", d: "Each analyst learns" },
];

export default async function ProofPage() {
  await loadRecords();
  const all = records().filter((r) => r.commitDigest).reverse();
  const lessons = all.flatMap((r) => r.lessons.filter((l) => l.blobId).map((l) => ({ ...l, r })));
  const results = all.filter((r) => r.result).length;
  return (
    <main className="wrap">
      <div className="section">
        <div className="eyebrow">Don&apos;t trust, check</div>
        <h1 className="page-title">Every pick is provable</h1>
        <p className="muted" style={{ maxWidth: 560 }}>Nothing can be changed after the game starts. Anyone can re-check it.</p>
      </div>

      <div className="flow">
        {STEPS.map((s) => (
          <div className="flow-step" key={s.k}>
            <span className="flow-k num">{s.k}</span>
            <b>{s.t}</b>
            <span className="muted">{s.d}</span>
          </div>
        ))}
      </div>

      <div className="proof-stats">
        <div className="ap-kpi"><b className="num">{picksLocked().toLocaleString("en-US")}</b><span>Picks locked on Sui</span></div>
        <div className="ap-kpi"><b className="num">{results}</b><span>Results on Sui</span></div>
        <div className="ap-kpi"><b className="num">{lessons.length}</b><span>Lessons on Walrus</span></div>
        <div className="verify-box">
          <span className="ap-label">Verify it yourself</span>
          <span>Press <b>Verify</b> on any match. Your browser checks it against Sui directly.</span>
          <span className="muted">Developers: <code>npm run verify</code> re-checks everything.</span>
        </div>
      </div>

      <section className="section">
        <div className="section-head"><h2>Every series</h2></div>
        <div className="lpanel">
          {all.map((r) => (
            <div className="prow" key={r.series.matchId}>
              <Link href={`/match/${r.series.matchId}`} className="prow-match"><b>{r.series.teamA}</b> <span className="muted">vs</span> <b>{r.series.teamB}</b> <span className="muted">· {r.series.block}</span></Link>
              <VerifyButton compact input={verifyInput(r)} title={`${r.series.teamA} vs ${r.series.teamB}`} />
              <a className="chip-link ok" href={suiscan(r, r.commitDigest)} target="_blank" rel="noreferrer">Picks locked ↗</a>
              {r.fans?.commitDigest ? <a className="chip-link ok" href={suiscan(r, r.fans.commitDigest)} target="_blank" rel="noreferrer">Fans locked ↗</a> : <span className="chip-link off">No fan picks</span>}
              {r.result ? <a className="chip-link ok" href={suiscan(r, r.result.resultDigest)} target="_blank" rel="noreferrer">{r.status === "void" ? "Void · refunded" : `${r.result.winner} ${r.result.score}`} ↗</a> : <span className="chip-link off">Result pending</span>}
              <span className={`chip-link ${r.lessons.some((l) => l.blobId) ? "ok" : "off"}`}>{r.lessons.filter((l) => l.blobId).length} lessons</span>
            </div>
          ))}
        </div>
      </section>

      {lessons.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Walrus Memory</h2></div>
          <div className="timeline">
            {lessons.map((l) => (
              <div className="memory" key={l.blobId}>
                <div className="memory-meta"><span>{persona(l.player)?.name} · {l.r.series.teamA} vs {l.r.series.teamB}</span><a className="walrus" href={walruscan(l.blobId)} target="_blank" rel="noreferrer">Walrus ↗</a></div>
                <div className="lesson">{lessonText(l.text)}</div>
              </div>
            ))}
          </div>
        </section>
      )}

    </main>
  );
}
