// Simple read-only KDAce board: upcoming picks, the leaderboard, and settled series with proof links.
// Deliberately plain; the real UI comes later.
import { ANALYSTS } from "../../src/core/analysts.ts";
import { aiConsensus } from "../../src/core/consensus.ts";
import type { SeriesRecord } from "../../src/core/store.ts";
import { store } from "../lib/data";

export const dynamic = "force-dynamic";

const network = process.env.SUI_NETWORK ?? "mainnet";
const name = (player: string) => ANALYSTS.find((a) => a.player === player)?.name ?? player;
const when = (iso: string) => new Date(iso).toUTCString().replace(":00 GMT", " UTC");

function Picks({ r }: { r: SeriesRecord }) {
  const consensus = aiConsensus(r.picks, r.series.teamA);
  return (
    <>
      {consensus !== null && (
        <div style={{ margin: "6px 0 10px" }}>
          <div className="muted">
            AI consensus: {r.series.teamA} {consensus.toFixed(0)}% · {r.series.teamB} {(100 - consensus).toFixed(0)}%
          </div>
          <div className="bar"><div style={{ width: `${consensus}%` }} /></div>
        </div>
      )}
      <table>
        <tbody>
          {r.picks.map((p) => (
            <tr key={p.player}>
              <td><b>{name(p.player)}</b></td>
              <td>{p.winner}{p.score ? ` ${p.score}` : ""} ({p.winProbability}%)</td>
              <td className="muted">{p.reasoning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function Home() {
  const all = store().all().sort((a, b) => a.series.startTime.localeCompare(b.series.startTime));
  const upcoming = all.filter((r) => r.status === "committed");
  const settled = all.filter((r) => r.status === "settled").reverse();
  const board = store().readBoard();

  return (
    <main>
      <h1>KDAce</h1>
      <p className="muted">Who actually reads Worlds 2026? Five AI analysts pick every series blind. Every pick is committed on Sui before the game, and every lesson is saved to Walrus Memory.</p>

      <h2>Upcoming</h2>
      {upcoming.length === 0 && <p className="muted">No committed picks yet.</p>}
      {upcoming.map((r) => (
        <div className="card" key={r.series.matchId}>
          <b>{r.series.teamA} vs {r.series.teamB}</b> <span className="muted">· {r.series.block} · Bo{r.series.bestOf} · {when(r.series.startTime)}</span>
          <Picks r={r} />
          <div className="muted">Committed before the game: <a href={`https://suiscan.xyz/${network}/tx/${r.commitDigest}`}>{r.commitDigest?.slice(0, 10)}…</a></div>
        </div>
      ))}

      <h2>Board</h2>
      {board.length === 0 ? <p className="muted">No settled series yet.</p> : (
        <table>
          <thead><tr><th>#</th><th>Player</th><th>Points</th><th>KDA</th></tr></thead>
          <tbody>
            {board.map((row, i) => (
              <tr key={row.player}><td>{i + 1}</td><td>{name(row.player)}</td><td>{row.points}</td><td>{row.k} / {row.d} / {row.a}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Results</h2>
      {settled.length === 0 && <p className="muted">Nothing settled yet.</p>}
      {settled.map((r) => (
        <div className="card" key={r.series.matchId}>
          <b>{r.series.teamA} vs {r.series.teamB}</b> <span className="muted">· {r.result!.winner} won {r.result!.score}</span>
          <Picks r={r} />
          {r.debate && <pre style={{ whiteSpace: "pre-wrap", font: "inherit" }}>{r.debate}</pre>}
          <div className="muted">Lessons saved to Walrus:</div>
          <ul>
            {r.lessons.map((l) => (
              <li key={l.blobId}>{l.text.split(" (from ")[0]} <a href={`https://walruscan.com/mainnet/blob/${l.blobId}`}>blob</a></li>
            ))}
          </ul>
          <div className="muted">
            <a href={`https://suiscan.xyz/${network}/tx/${r.commitDigest}`}>commit</a> · <a href={`https://suiscan.xyz/${network}/tx/${r.result!.resultDigest}`}>result</a>
          </div>
        </div>
      ))}
    </main>
  );
}
