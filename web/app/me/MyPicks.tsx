"use client";
// A fan's record: stats up top, then every buy as its own position (upcoming), and settled matches with the result,
// AXP won or lost, and a Claim button on wins.
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { teamColor } from "../../lib/teams";
import { Axp, TeamLogo } from "../ui/bits";
import Pnl from "../ui/Pnl";
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
  const { me, ready, signIn, claim, cancelBuy } = useFans();
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
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

  // Each buy is its own position. Upcoming lists them one by one; history groups them by match (one result, one claim).
  const buys = (me.buys ?? []).filter((b) => matches[b.matchId]);
  const upcomingBuys = buys.filter((b) => !matches[b.matchId].result).sort((a, b) => matches[a.matchId].start.localeCompare(matches[b.matchId].start) || a.at.localeCompare(b.at));
  const results = new Map((me.results ?? []).map((r) => [r.matchId, r]));
  const settledIds = [...new Set(buys.filter((b) => matches[b.matchId].result).map((b) => b.matchId))].sort((a, b) => matches[b].start.localeCompare(matches[a].start));
  const history = settledIds.map((id) => ({ m: matches[id], buys: buys.filter((b) => b.matchId === id), res: results.get(id) }));
  const won = history.filter((x) => (x.m.axp[`fan:${me.address}`] ?? 0) > 0).length;
  const axp = me.axp ?? { start: 10000, settled: 0, open: 0, claimable: 0, available: 10000 };
  const toClaim = axp.claimable ?? 0;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const row = board.find((r) => r.player === `fan:${me.address}`);
  const count = tab === "upcoming" ? upcomingBuys.length : history.length;
  const teamTone = (m: MyMatch, c: string) => (c === m.teamA ? "var(--ta)" : c === m.teamB ? "var(--tb)" : "var(--fg)");
  const vars = (m: MyMatch) => ({ "--ta": teamColor(m.teamA), "--tb": teamColor(m.teamB) }) as CSSProperties;
  const teams = (m: MyMatch) => (
    <div className="lr-teams">
      <span className="lr-team" translate="no"><TeamLogo code={m.teamA} logo={m.logoA} /><b>{m.teamA}</b></span>
      <span className="lr-team" translate="no"><TeamLogo code={m.teamB} logo={m.logoB} /><b>{m.teamB}</b></span>
    </div>
  );

  return (
    <>
      <div className="me-head">
        <div className="me-name"><span className="ap-label">Signed in as</span><b>{me.displayName}</b></div>
        <div className="me-kpis">
          <div className="ap-kpi big"><b className="num bal"><Axp size={28} /> {fmt(axp.available)} <Pnl net={axp.settled} className="text-sm" /></b><span>Balance · AXP you can bet</span></div>
          <div className="ap-kpi"><b className="num">{fmt(axp.open)}</b><span>In play</span></div>
          {toClaim > 0 && <div className="ap-kpi"><b className="num right">{fmt(toClaim)}</b><span>To claim</span></div>}
          <div className="ap-kpi"><b className="num">{fmt(axp.start + axp.settled)}</b><span>Total value</span></div>
          <div className="ap-kpi"><b className={`num ${axp.settled > 0 ? "right" : axp.settled < 0 ? "wrong" : ""}`}>{axp.settled > 0 ? "+" : ""}{fmt(axp.settled)}</b><span>Profit</span></div>
          <div className="ap-kpi"><b className="num">{row ? `#${row.rank}` : "-"}</b><span>Rank{history.length ? ` · won ${won}/${history.length}` : ""}</span></div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "upcoming" ? "on" : ""} onClick={() => setTab("upcoming")}>Open positions <span className="num">{upcomingBuys.length}</span></button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>History <span className="num">{history.length}</span></button>
      </div>

      {count === 0 ? (
        <div className="panel empty-state">
          <b>{tab === "upcoming" ? "No open positions" : "No results yet"}</b>
          <span className="muted">{tab === "upcoming" ? "Buy an outcome before the match locks." : "Settled positions show up here."}</span>
          {tab === "upcoming" && <Link href="/matches" className="btn" style={{ marginTop: 8 }}>Browse matches</Link>}
        </div>
      ) : tab === "upcoming" ? (
        <div className="lpanel">
          {upcomingBuys.map((b) => {
            const m = matches[b.matchId];
            return (
              <Link key={b.id} href={`/match/${m.matchId}`} className="mrow" style={vars(m)}>
                <div className="lr-time"><b className="num"><LocalTime iso={m.start} format="time" /></b><span><LocalTime iso={m.start} format="day" /></span></div>
                {teams(m)}
                <div className="mrow-pick">
                  <span className="ap-label">{b.market === "score" ? "Score" : "Winner"} · bought <LocalTime iso={b.at} format="time" /></span>
                  <b><span style={{ color: teamTone(m, b.choice) }}>{b.choice}</span> · <span className="num">{fmt(b.amount)} AXP</span></b>
                </div>
                <div className="mrow-res"><span className="ap-label">Status</span><b className="muted">{m.fansLocked ? "Locked on Sui" : "Open"}</b></div>
                {m.fansLocked || Date.parse(m.start) - 5 * 60_000 <= Date.now() ? (
                  <span className="call-res">Pending</span>
                ) : (
                  <button
                    type="button"
                    disabled={cancelling === b.id}
                    onClick={async (e) => { e.preventDefault(); e.stopPropagation(); setCancelling(b.id); await cancelBuy(b.id); setCancelling(null); }}
                    className="btn ghost sm"
                    title="Cancel this bet and get the AXP back (until the match locks)"
                  >
                    {cancelling === b.id ? "Cancelling…" : "Cancel"}
                  </button>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="lpanel">
          {history.map(({ m, buys: mb, res }) => {
            const pts = m.axp[`fan:${me.address}`] ?? 0;
            const right = pts > 0;
            return (
              <Link key={m.matchId} href={`/match/${m.matchId}`} className="mrow" style={vars(m)}>
                <div className="lr-time"><b className="num"><LocalTime iso={m.start} format="time" /></b><span><LocalTime iso={m.start} format="day" /></span></div>
                {teams(m)}
                <div className="mrow-pick">
                  <span className="ap-label">{mb.length} position{mb.length > 1 ? "s" : ""} · {fmt(mb.reduce((a, b) => a + b.amount, 0))} AXP</span>
                  <b>{mb.map((b, i) => <span key={b.id} style={{ color: teamTone(m, b.choice) }}>{i ? " · " : ""}{b.choice} {fmt(b.amount)}</span>)}</b>
                </div>
                <div className="mrow-res"><span className="ap-label">Result</span><b>{m.result!.winner} {m.result!.score}</b></div>
                {res?.claimable ? (
                  <button
                    type="button"
                    disabled={claiming === m.matchId}
                    onClick={async (e) => { e.preventDefault(); e.stopPropagation(); setClaiming(m.matchId); await claim(m.matchId); setClaiming(null); }}
                    className="btn sm"
                  >
                    {claiming === m.matchId ? "Claiming…" : `Claim ${fmt(res.payout)}`}
                  </button>
                ) : (
                  <span className={`call-res ${right ? "w" : "l"}`}>{right ? (res?.claimedAt ? `Claimed +${fmt(pts)}` : `+${fmt(pts)} AXP`) : `${fmt(pts)} AXP`}</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
