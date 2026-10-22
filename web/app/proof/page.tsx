// Proof: how every claim on KDAce can be re-checked, plus every commit, result and memory link.
import Link from "next/link";
import { persona } from "../../lib/personas";
import { lessonText, records, suiscan, walruscan } from "../../lib/site";

export const metadata = { title: "Proof · KDAce" };

export default function ProofPage() {
  const all = records().filter((r) => r.commitDigest).reverse();
  const lessons = all.flatMap((r) => r.lessons.filter((l) => l.blobId).map((l) => ({ ...l, r })));
  return (
    <main className="wrap">
      <div className="section prose">
        <div className="eyebrow">Don&apos;t trust, check</div>
        <h1 className="page-title">How KDAce proves every pick</h1>
        <p>Anyone can say they called it. KDAce makes the analysts (and you) prove it. Three things are public and checkable:</p>
        <div className="steps">
          <div className="step"><b>1 · Picks are locked before the game</b>Every pick for a match is bundled and fingerprinted, and the fingerprint is written to the Sui blockchain before the game starts. Change one pick later and the fingerprint no longer matches.</div>
          <div className="step"><b>2 · Results are posted on Sui</b>The official result from the lolesports schedule is posted on Sui too, and the points are recomputed from the published picks.</div>
          <div className="step"><b>3 · Memories are real and on time</b>Each analyst&apos;s lessons are stored in Walrus Memory. Every lesson an analyst used for a pick was saved <i>before</i> that pick, and each analyst only reads its own memory.</div>
        </div>
        <h2>Check it yourself</h2>
        <p>The code is open. Run <code>npm run verify</code>: it reads every transaction back from Sui through Tatum and checks each fingerprint, each timestamp, each result, each memory and the whole board. All picks, fingerprints and lessons are published in the repository&apos;s <code>data/</code> folder.</p>
        <p>Honest limits: one KDAce key posts results (anyone can compare them with the official schedule), and fan picks rely on our database&apos;s clock for the minute between lock and the on-chain commit. Each fan&apos;s pick receipt lets them check they&apos;re in the batch.</p>
      </div>

      <section className="section">
        <div className="section-head"><h2>Every series</h2><span className="muted">{all.length} locked on Sui</span></div>
        <div className="panel">
          <table className="table">
            <thead><tr><th>Match</th><th>Picks locked</th><th>Fans</th><th>Result</th><th>Memories</th></tr></thead>
            <tbody>
              {all.map((r) => (
                <tr key={r.series.matchId}>
                  <td><Link href={`/match/${r.series.matchId}`}><b>{r.series.teamA} vs {r.series.teamB}</b> <span className="muted">· {r.series.block}</span></Link></td>
                  <td><a className="walrus" href={suiscan(r, r.commitDigest)} target="_blank" rel="noreferrer">{r.commitDigest!.slice(0, 8)}… ↗</a></td>
                  <td>{r.fans?.commitDigest ? <a className="walrus" href={suiscan(r, r.fans.commitDigest)} target="_blank" rel="noreferrer">{r.fans.commitDigest.slice(0, 8)}… ↗</a> : <span className="muted">-</span>}</td>
                  <td>{r.result ? <a className="walrus" href={suiscan(r, r.result.resultDigest)} target="_blank" rel="noreferrer">{r.result.winner} {r.result.score} ↗</a> : <span className="muted">pending</span>}</td>
                  <td className="num">{r.lessons.filter((l) => l.blobId).length || <span className="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Walrus Memory</h2><span className="muted">{lessons.length} lessons saved</span></div>
        {lessons.length === 0 && <p className="muted">Lessons appear after the first settled series.</p>}
        <div className="timeline">
          {lessons.map((l) => (
            <div className="memory" key={l.blobId}>
              <div className="memory-meta"><span>{persona(l.player)?.name} · {l.r.series.teamA} vs {l.r.series.teamB}</span><a className="walrus" href={walruscan(l.blobId)} target="_blank" rel="noreferrer">{l.blobId.slice(0, 10)}… ↗</a></div>
              <div className="lesson">{lessonText(l.text)}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
