"use client";
// One series as a broadcast-style market card: team-tinted matchup header, tug-of-war splits for the AI analysts and the
// fans, a draft-style strip showing which side each role analyst backed, a lock countdown and pick buttons.
import Link from "next/link";
import type { CSSProperties } from "react";
import type { CardData } from "../../lib/site";
import { teamColor } from "../../lib/teams";
import { Avatar, RoleIcon, TeamLogo } from "./bits";
import Countdown from "./Countdown";
import LocalTime from "./LocalTime";
import SpotlightCard from "./rb/SpotlightCard";
import { useFans } from "./FanProvider";

const SCORES: Record<number, string[]> = { 1: [], 3: ["2-0", "2-1"], 5: ["3-0", "3-1", "3-2"] };
const LOCK_MS = 5 * 60_000;

/** Two team colours pushing against each other, like a broadcast win-probability bar. */
function TugBar({ label, pctA, empty }: { label: string; pctA: number | null; empty: string }) {
  if (pctA === null)
    return (
      <div className="tug">
        <div className="tug-row"><span className="muted">-</span><span className="tug-label">{label} · {empty}</span><span className="muted">-</span></div>
        <div className="tug-bar"><i style={{ flex: 1, background: "#1d1d1d" }} /></div>
      </div>
    );
  const pa = Math.round(pctA), pb = 100 - pa;
  return (
    <div className="tug">
      <div className="tug-row">
        <b className="num" style={{ color: pa >= pb ? "var(--fg)" : "var(--kd-muted)" }}>{pa}%</b>
        <span className="tug-label">{label}</span>
        <b className="num" style={{ color: pb > pa ? "var(--fg)" : "var(--kd-muted)" }}>{pb}%</b>
      </div>
      <div className="tug-bar">
        <i style={{ flex: pa, background: `var(--ta)` }} />
        <i style={{ flex: pb, background: `var(--tb)` }} />
      </div>
    </div>
  );
}

/** Game pips for the series format: one per game needed to win, filled when won. */
function Pips({ bestOf, wins }: { bestOf: number; wins: number }) {
  return (
    <span className="pips">
      {Array.from({ length: Math.ceil(bestOf / 2) }, (_, i) => <i key={i} className={i < wins ? "on" : ""} />)}
    </span>
  );
}

export default function MatchCard({ c }: { c: CardData }) {
  const { open, openSlip } = useFans();
  const s = c.series, live = open[s.matchId];
  const lockAt = live?.lockAt ?? new Date(Date.parse(s.startTime) - LOCK_MS).toISOString();
  const closed = !!c.result || Date.parse(lockAt) <= Date.now();
  const fans = live?.crowd.fans ?? 0;
  const fanPctA = fans ? ((live!.crowd.winner[s.teamA] ?? 0) / fans) * 100 : null;
  const mine = live?.mine ?? {};
  const aiPool: Record<string, number> = {};
  for (const a of c.calls) aiPool[a.winner] = (aiPool[a.winner] ?? 0) + a.stake;
  const slipMatch = { matchId: s.matchId, teamA: s.teamA, teamB: s.teamB, logoA: c.logoA, logoB: c.logoB, bestOf: s.bestOf, block: s.block, aiPool };
  const winsOf = (t: string) => (c.result ? (c.result.winner === t ? +c.result.score.split("-")[0] : +c.result.score.split("-")[1]) : 0);
  const side = (t: string) => c.calls.filter((a) => a.winner === t);
  const vars = { "--ta": teamColor(s.teamA), "--tb": teamColor(s.teamB) } as CSSProperties;

  return (
    <SpotlightCard className="card match" spotlightColor="rgba(255,255,255,0.08)" intensity={0.1} spotlightSize={260} style={{ padding: 0, borderRadius: 14, background: "var(--panel)", ...vars }}>
      <div className="mh">
        <div className="mh-side a"><TeamLogo code={s.teamA} logo={c.logoA} /></div>
        <div className="mh-side b"><TeamLogo code={s.teamB} logo={c.logoB} /></div>
        <div className="mh-vs"><span>VS</span></div>
        <span className="mh-tag">{s.block} · Bo{s.bestOf}</span>
        <span className="mh-clock">{c.result ? "FINAL" : <Countdown lockAt={lockAt} />}</span>
      </div>

      <div className="card-body">
        <div className="score-row">
          <div className="sr-team">
            <span className="sr-code display">{s.teamA}</span>
            {s.bestOf > 1 ? <Pips bestOf={s.bestOf} wins={winsOf(s.teamA)} /> : null}
          </div>
          <div className="sr-mid">
            {c.result ? <span className="sr-score display num">{winsOf(s.teamA)}<i>:</i>{winsOf(s.teamB)}</span> : <span className="sr-time"><LocalTime iso={s.startTime} /></span>}
          </div>
          <div className="sr-team b">
            {s.bestOf > 1 ? <Pips bestOf={s.bestOf} wins={winsOf(s.teamB)} /> : null}
            <span className="sr-code display">{s.teamB}</span>
          </div>
        </div>

        <TugBar label="AI analysts" pctA={c.consensusA} empty="picks coming" />
        <TugBar label={fans ? `Fans · ${fans}` : "Fans"} pctA={fanPctA} empty="no picks yet" />

        {c.calls.length > 0 && <div className="draft" aria-label="Which side each analyst picked">
          {[s.teamA, s.teamB].map((t, k) => (
            <div key={t} className={`draft-side ${k ? "b" : "a"}`}>
              {side(t).map((a) => (
                <span key={a.player} className={`draft-slot ${c.result ? (a.winner === c.result.winner ? "right" : "wrong") : ""}`} title={`${a.name} picked ${t} (${a.prob}%)`}>
                  <Avatar name={a.name} color={a.color} art={a.art} size={26} />
                  <RoleIcon role={a.player.replace("analyst-", "")} size={12} />
                </span>
              ))}
            </div>
          ))}
        </div>}

        {!c.result && (
          <>
            <div className="picks">
              {[s.teamA, s.teamB].map((t, k) => (
                <button key={t} className={`pick ${k ? "b" : "a"} ${mine.winner?.[t] ? "on" : ""}`} disabled={closed} onClick={() => openSlip({ match: slipMatch, market: "winner", choice: t })}>
                  {mine.winner?.[t] ? `${t} · ${mine.winner[t].toLocaleString("en-US")}` : t}
                </button>
              ))}
            </div>
            {s.bestOf > 1 && (
              <div className="chips">
                {SCORES[s.bestOf].map((sc) => (
                  <button key={sc} className={`chip num ${mine.score?.[sc] ? "on" : ""}`} disabled={closed} onClick={() => openSlip({ match: slipMatch, market: "score", choice: sc })}>{sc}</button>
                ))}
                <span className="chip-note">exact score</span>
              </div>
            )}
          </>
        )}

        <div className="card-foot-row">
          <Link className="card-foot" href={`/match/${s.matchId}`}>Details →</Link>
        </div>
      </div>
    </SpotlightCard>
  );
}
