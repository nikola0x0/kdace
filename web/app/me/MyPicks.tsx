"use client";
// A fan's record: stats up top, then upcoming picks and history as rows with their pick, the result and AXP won or lost.
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { teamColor } from "../../lib/teams";
import { TeamLogo } from "../ui/bits";
import { useFans } from "../ui/FanProvider";
import LocalTime from "../ui/LocalTime";

export type MyMatch = {
  matchId: string; teamA: string; teamB: string; block: string; bestOf: 1 | 3 | 5; start: string;
  logoA: string | null; logoB: string | null;
  result: { winner: string; score: string } | null;
  axp: Record<string, number>;
  fansLocked: boolean;
};
type BoardRow = { player: string; rank: number; balance: number; k: number; d: number; a: number };

export default function MyPicks({ matches, board }: { matches: Record<string, MyMatch>; board: BoardRow[] }) {
  const { me, ready, signIn } = useFans();
  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  if (!ready) return <div className="panel muted">Loading…</div>;
  if (!me)
    return (
      <div className="panel empty-state">
        <b>Sign in to see your matches</b>
        <span className="muted">Picks are free. Call every series and race the AI analysts.</span>
        <button className="btn" onClick={signIn} style={{ marginTop: 8 }}>Sign in</button>
      </div>
    );

  const byMatch = new Map<string, Record<string, string>>();
  for (const p of me.picks) byMatch.set(p.matchId, { ...(byMatch.get(p.matchId) ?? {}), [p.market]: p.choice });
  const mine = [...byMatch.entries()].filter(([id]) => matches[id]).map(([id, pick]) => ({ m: matches[id], pick }));
  const upcoming = mine.filter((x) => !x.m.result).sort((a, b) => a.m.start.localeCompare(b.m.start));
  const history = mine.filter((x) => x.m.result).sort((a, b) => b.m.start.localeCompare(a.m.start));
  const correct = history.filter((x) => x.pick.winner === x.m.result!.winner).length;
  const row = board.find((r) => r.player === `fan:${me.address}`);
  const list = tab === "upcoming" ? upcoming : history;

  return (
    <>
      <div className="me-head">
        <div className="me-name"><span className="ap-label">Signed in as</span><b>{me.displayName}</b></div>
        <div className="me-kpis">
          <div className="ap-kpi big"><b className="num">{history.length ? `${Math.round((correct / history.length) * 100)}%` : "-"}</b><span>Accuracy{history.length ? ` · ${correct}/${history.length}` : ""}</span></div>
          <div className="ap-kpi"><b className="num">{(row?.balance ?? 10000).toLocaleString("en-US")}</b><span>AXP</span></div>
          <div className="ap-kpi"><b className="num">{row ? `#${row.rank}` : "-"}</b><span>Board rank</span></div>
          <div className="ap-kpi"><b className="num">{row ? `${row.k}/${row.d}/${row.a}` : "0/0/0"}</b><span>K / D / A</span></div>
          <div className="ap-kpi"><b className="num">{mine.length}</b><span>Picks made</span></div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "upcoming" ? "on" : ""} onClick={() => setTab("upcoming")}>Upcoming <span className="num">{upcoming.length}</span></button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History <span className="num">{history.length}</span></button>
      </div>

      {list.length === 0 ? (
        <div className="panel empty-state">
          <b>{tab === "upcoming" ? "No open picks" : "No results yet"}</b>
          <span className="muted">{tab === "upcoming" ? "Pick a match before it locks." : "Your settled picks show up here."}</span>
          {tab === "upcoming" && <Link href="/matches" className="btn" style={{ marginTop: 8 }}>Browse matches</Link>}
        </div>
      ) : (
        <div className="lpanel">
          {list.map(({ m, pick }) => {
            const right = m.result ? pick.winner === m.result.winner : null;
            const pts = m.axp[`fan:${me.address}`] ?? 0;
            const vars = { "--ta": teamColor(m.teamA), "--tb": teamColor(m.teamB) } as CSSProperties;
            return (
              <Link key={m.matchId} href={`/match/${m.matchId}`} className="mrow" style={vars}>
                <div className="lr-time"><b className="num"><LocalTime iso={m.start} format="time" /></b><span><LocalTime iso={m.start} format="day" /></span></div>
                <div className="lr-teams">
                  <span className="lr-team"><TeamLogo code={m.teamA} logo={m.logoA} /><b>{m.teamA}</b></span>
                  <span className="lr-team"><TeamLogo code={m.teamB} logo={m.logoB} /><b>{m.teamB}</b></span>
                </div>
                <div className="mrow-pick">
                  <span className="ap-label">Your pick</span>
                  <b style={{ color: pick.winner === m.teamA ? "var(--ta)" : "var(--tb)" }}>{pick.winner ?? "-"}{pick.score ? ` ${pick.score}` : ""}</b>
                </div>
                <div className="mrow-res">
                  {m.result ? <><span className="ap-label">Result</span><b>{m.result.winner} {m.result.score}</b></> : <><span className="ap-label">Status</span><b className="muted">{m.fansLocked ? "Locked on Sui" : "Open"}</b></>}
                </div>
                <span className={`call-res ${right === null ? "" : right ? "w" : "l"}`}>{right === null ? "Pending" : `${pts > 0 ? "+" : ""}${pts.toLocaleString("en-US")} AXP`}</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
