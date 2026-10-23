"use client";
// The match list: one row per series with both outcomes as buttons, like a prediction market board.
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import type { CardData } from "../../lib/site";
import { winnerOdds } from "../../lib/odds";
import { teamColor } from "../../lib/teams";
import { TeamLogo } from "../ui/bits";
import Countdown from "../ui/Countdown";
import { useFans } from "../ui/FanProvider";
import LocalTime from "../ui/LocalTime";

const LOCK_MS = 5 * 60_000;

function Row({ c }: { c: CardData }) {
  const { open, openSlip } = useFans();
  const s = c.series, live = open[s.matchId];
  const lockAt = live?.lockAt ?? new Date(Date.parse(s.startTime) - LOCK_MS).toISOString();
  const closed = !!c.result || c.void || Date.parse(lockAt) <= Date.now();

  const mine = live?.mine.winner ?? {};
  const aiPool = c.aiPool; // morning stakes plus final-call top-ups
  const slipMatch = { matchId: s.matchId, teamA: s.teamA, teamB: s.teamB, logoA: c.logoA, logoB: c.logoB, bestOf: s.bestOf, block: s.block, aiPool };
  const odds = winnerOdds(s.teamA, s.teamB, aiPool, live?.crowd.winnerPool);
  const aiA = odds.aiPctA === null ? null : Math.round(odds.aiPctA);
  const fanA = odds.fanPctA === null ? null : Math.round(odds.fanPctA);
  const vars = { "--ta": teamColor(s.teamA), "--tb": teamColor(s.teamB) } as CSSProperties;
  const outcome = (t: string, k: 0 | 1) => {
    const won = c.result?.winner === t;
    return (
      <button key={t} className={`oc ${k ? "b" : "a"} ${mine[t] ? "on" : ""} ${c.result ? (won ? "won" : "lost") : ""}`} disabled={closed} onClick={() => openSlip({ match: slipMatch, market: "winner", choice: t })}>
        <span className="oc-team">{t}</span>
        <span className="oc-pct num">{c.result ? (won ? "Won" : "") : (k ? odds.multB : odds.multA) === null ? "" : `${(k ? odds.multB : odds.multA)!.toFixed(2)}×`}</span>
      </button>
    );
  };
  return (
    <div className="lrow" style={vars}>
      <div className="lr-time">
        <b className="num"><LocalTime iso={s.startTime} format="time" /></b>
        <span>{s.block} · Bo{s.bestOf}</span>
      </div>
      <Link href={`/match/${s.matchId}`} className="lr-teams">
        <span className="lr-team"><TeamLogo code={s.teamA} logo={c.logoA} /><b>{s.teamA}</b>{c.result && <em className="num">{c.result.winner === s.teamA ? c.result.score.split("-")[0] : c.result.score.split("-")[1]}</em>}</span>
        <span className="lr-team"><TeamLogo code={s.teamB} logo={c.logoB} /><b>{s.teamB}</b>{c.result && <em className="num">{c.result.winner === s.teamB ? c.result.score.split("-")[0] : c.result.score.split("-")[1]}</em>}</span>
      </Link>
      <div className="lr-stat">
        <span className="lr-k">AI</span>
        <div className="mini-tug"><i style={{ flex: aiA ?? 50, background: aiA === null ? "#222" : "var(--ta)" }} /><i style={{ flex: aiA === null ? 50 : 100 - aiA, background: aiA === null ? "#222" : "var(--tb)" }} /></div>
        <span className="lr-k">Fans</span>
        <div className="mini-tug"><i style={{ flex: fanA ?? 50, background: fanA === null ? "#222" : "var(--ta)" }} /><i style={{ flex: fanA === null ? 50 : 100 - fanA, background: fanA === null ? "#222" : "var(--tb)" }} /></div>
      </div>
      <div className="lr-out">{outcome(s.teamA, 0)}{outcome(s.teamB, 1)}{Object.keys(mine).length > 0 && <span className="lr-held num">You hold {Object.entries(mine).map(([t, v]) => `${v.toLocaleString("en-US")} on ${t}`).join(" · ")}</span>}</div>
      <div className="lr-lock">{c.void ? <span className="muted">Void · refunded</span> : c.result ? <span className="muted">Final</span> : <Countdown lockAt={lockAt} />}</div>
    </div>
  );
}

export default function MatchList({ upcoming, settled }: { upcoming: CardData[]; settled: CardData[] }) {
  const [tab, setTab] = useState<"upcoming" | "results">("upcoming");
  const list = tab === "upcoming" ? upcoming : settled;
  // Group into match days: a new group starts when a series begins 20+ hours after the group's first one, so a day's
  // slate stays together in every timezone.
  const groups = useMemo(() => {
    const out: [string, CardData[]][] = [];
    for (const c of list) {
      const g = out[out.length - 1];
      if (g && Math.abs(Date.parse(c.series.startTime) - Date.parse(g[1][0].series.startTime)) < 20 * 3600_000) g[1].push(c);
      else out.push([c.series.matchId, [c]]);
    }
    return out;
  }, [list]);
  return (
    <>
      <div className="tabs">
        <button className={tab === "upcoming" ? "on" : ""} onClick={() => setTab("upcoming")}>Upcoming <span className="num">{upcoming.length}</span></button>
        <button className={tab === "results" ? "on" : ""} onClick={() => setTab("results")}>Results <span className="num">{settled.length}</span></button>
      </div>
      {groups.length === 0 && <p className="muted">{tab === "upcoming" ? "No matches scheduled right now." : "No results yet."}</p>}
      {groups.map(([day, rows]) => (
        <section key={day} className="lgroup">
          <div className="lgroup-head"><LocalTime iso={rows[0].series.startTime} format="day" /></div>
          <div className="lpanel">{rows.map((c) => <Row key={c.series.matchId} c={c} />)}</div>
        </section>
      ))}
    </>
  );
}
