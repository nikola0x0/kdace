"use client";
// A fan's record: stats up top, then upcoming picks and history as rows with their pick, the result and AXP won or lost.
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { teamColor } from "../../lib/teams";
import { Axp, TeamLogo } from "../ui/bits";
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
        <span className="muted">Everyone starts with 10,000 AXP. Buy outcomes on every series and race the AI analysts.</span>
        <button className="btn" onClick={signIn} style={{ marginTop: 8 }}>Sign in</button>
      </div>
    );

  // Positions per match: market -> outcome -> AXP held (buys add up).
  const byMatch = new Map<string, Record<string, Record<string, number>>>();
  for (const p of me.picks) {
    const pos = byMatch.get(p.matchId) ?? {};
    (pos[p.market] ??= {})[p.choice] = p.stake ?? 0;
    byMatch.set(p.matchId, pos);
  }
  const mine = [...byMatch.entries()].filter(([id]) => matches[id]).map(([id, pos]) => ({ m: matches[id], pos }));
  const upcoming = mine.filter((x) => !x.m.result).sort((a, b) => a.m.start.localeCompare(b.m.start));
  const history = mine.filter((x) => x.m.result).sort((a, b) => b.m.start.localeCompare(a.m.start));
  const won = history.filter((x) => (x.m.axp[`fan:${me.address}`] ?? 0) > 0).length;
  const axp = me.axp ?? { start: 10000, settled: 0, open: 0, available: 10000 };
  const fmt = (n: number) => n.toLocaleString("en-US");
  const row = board.find((r) => r.player === `fan:${me.address}`);
  const list = tab === "upcoming" ? upcoming : history;

  return (
    <>
      <div className="me-head">
        <div className="me-name"><span className="ap-label">Signed in as</span><b>{me.displayName}</b></div>
        <div className="me-kpis">
          <div className="ap-kpi big"><b className="num bal"><Axp size={28} /> {fmt(axp.start + axp.settled)}</b><span>AXP balance</span></div>
          <div className="ap-kpi"><b className="num">{fmt(axp.available)}</b><span>Available</span></div>
          <div className="ap-kpi"><b className="num">{fmt(axp.open)}</b><span>In open positions</span></div>
          <div className="ap-kpi"><b className={`num ${axp.settled > 0 ? "right" : axp.settled < 0 ? "wrong" : ""}`}>{axp.settled > 0 ? "+" : ""}{fmt(axp.settled)}</b><span>Profit</span></div>
          <div className="ap-kpi"><b className="num">{row ? `#${row.rank}` : "-"}</b><span>Rank{history.length ? ` · won ${won}/${history.length}` : ""}</span></div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "upcoming" ? "on" : ""} onClick={() => setTab("upcoming")}>Upcoming <span className="num">{upcoming.length}</span></button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History <span className="num">{history.length}</span></button>
      </div>

      {list.length === 0 ? (
        <div className="panel empty-state">
          <b>{tab === "upcoming" ? "No open positions" : "No results yet"}</b>
          <span className="muted">{tab === "upcoming" ? "Buy an outcome before the match locks." : "Settled positions show up here."}</span>
          {tab === "upcoming" && <Link href="/matches" className="btn" style={{ marginTop: 8 }}>Browse matches</Link>}
        </div>
      ) : (
        <div className="lpanel">
          {list.map(({ m, pos }) => {
            const pts = m.axp[`fan:${me.address}`] ?? 0;
            const right = m.result ? pts > 0 : null;
            const held = [...Object.entries(pos.winner ?? {}), ...Object.entries(pos.score ?? {})];
            const total = held.reduce((a, [, v]) => a + v, 0);
            const vars = { "--ta": teamColor(m.teamA), "--tb": teamColor(m.teamB) } as CSSProperties;
            return (
              <Link key={m.matchId} href={`/match/${m.matchId}`} className="mrow" style={vars}>
                <div className="lr-time"><b className="num"><LocalTime iso={m.start} format="time" /></b><span><LocalTime iso={m.start} format="day" /></span></div>
                <div className="lr-teams">
                  <span className="lr-team"><TeamLogo code={m.teamA} logo={m.logoA} /><b>{m.teamA}</b></span>
                  <span className="lr-team"><TeamLogo code={m.teamB} logo={m.logoB} /><b>{m.teamB}</b></span>
                </div>
                <div className="mrow-pick">
                  <span className="ap-label">Your positions · {fmt(total)} AXP</span>
                  <b>{held.map(([c, v], i) => <span key={c} style={{ color: c === m.teamA ? "var(--ta)" : c === m.teamB ? "var(--tb)" : "var(--fg)" }}>{i ? " · " : ""}{c} {fmt(v)}</span>)}</b>
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
