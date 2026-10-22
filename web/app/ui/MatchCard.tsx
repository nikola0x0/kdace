"use client";
// One series as a market card: teams, the AI analysts' consensus, the fan split, a lock countdown and pick buttons.
import Link from "next/link";
import type { CardData } from "../../lib/site";
import { Avatar, TeamLogo } from "./bits";
import Countdown from "./Countdown";
import LocalTime from "./LocalTime";
import { useFans } from "./FanProvider";

const SCORES: Record<number, string[]> = { 1: [], 3: ["2-0", "2-1"], 5: ["3-0", "3-1", "3-2"] };
const LOCK_MS = 5 * 60_000;

function Split({ label, a, b, pctA, kind }: { label: string; a: string; b: string; pctA: number | null; kind: "ai" | "fans" }) {
  if (pctA === null) return (
    <div className="meter">
      <div className="meter-row"><span>{label}</span><span>{kind === "ai" ? "Picks coming" : "No picks yet"}</span></div>
      <div className="bar2"><i className="empty" style={{ width: "100%" }} /></div>
    </div>
  );
  const lead = pctA >= 50 ? a : b, pct = Math.round(pctA >= 50 ? pctA : 100 - pctA);
  return (
    <div className="meter">
      <div className="meter-row"><span>{label}</span><b className="num">{lead} {pct}%</b></div>
      <div className={`bar2 ${kind}`}><i className="a" style={{ width: `${pctA}%` }} /><i className="b" style={{ width: `${100 - pctA}%` }} /></div>
    </div>
  );
}

export default function MatchCard({ c }: { c: CardData }) {
  const { open, pick, me } = useFans();
  const s = c.series, live = open[s.matchId];
  const lockAt = live?.lockAt ?? new Date(Date.parse(s.startTime) - LOCK_MS).toISOString();
  const closed = !!c.result || Date.parse(lockAt) <= Date.now();
  const fans = live?.crowd.fans ?? 0;
  const fanPctA = fans ? ((live!.crowd.winner[s.teamA] ?? 0) / fans) * 100 : null;
  const mine = live?.mine ?? {};

  return (
    <article className="card">
      <div className="card-top">
        <div className="glow a" /><div className="glow b" />
        <TeamLogo code={s.teamA} logo={c.logoA} />
        <span className="vs">vs</span>
        <TeamLogo code={s.teamB} logo={c.logoB} />
        <div className="dither-line" />
      </div>
      <div className="card-body">
        <div className="card-meta">
          <span>{s.block} · Bo{s.bestOf} · <LocalTime iso={s.startTime} /></span>
          {c.result ? <span className="lock">Final</span> : <Countdown lockAt={lockAt} />}
        </div>
        <div className="teams">
          <div className="team a">{s.teamA}{c.result && <span className={`res ${c.result.winner === s.teamA ? "w" : "l"}`}>{c.result.winner === s.teamA ? c.result.score.split("-")[0] : c.result.score.split("-")[1]}</span>}</div>
          <span className="vs">vs</span>
          <div className="team b">{c.result && <span className={`res ${c.result.winner === s.teamB ? "w" : "l"}`}>{c.result.winner === s.teamB ? c.result.score.split("-")[0] : c.result.score.split("-")[1]}</span>}{s.teamB}</div>
        </div>
        <Split label="AI analysts" a={s.teamA} b={s.teamB} pctA={c.consensusA} kind="ai" />
        <Split label={`Fans${fans ? ` · ${fans}` : ""}`} a={s.teamA} b={s.teamB} pctA={fanPctA} kind="fans" />
        {!c.result && (
          <>
            <div className="picks">
              {[s.teamA, s.teamB].map((t) => (
                <button key={t} className={`pick ${mine.winner === t ? "on" : ""}`} disabled={closed} onClick={() => pick(s.matchId, "winner", t)}>
                  {mine.winner === t ? "✓ " : ""}{t}
                </button>
              ))}
            </div>
            {s.bestOf > 1 && (
              <div className="chips">
                {SCORES[s.bestOf].map((sc) => (
                  <button key={sc} className={`chip num ${mine.score === sc ? "on" : ""}`} disabled={closed} onClick={() => pick(s.matchId, "score", sc)}>{sc}</button>
                ))}
                <span className="chip-note">exact score</span>
              </div>
            )}
            {!me && !closed && <span className="hint">Free to play · sign in to pick</span>}
          </>
        )}
        <div className="crew">
          <div className="crew-faces">
            {c.calls.map((a) => (
              <Avatar key={a.player} name={`${a.name}: ${a.winner}`} color={a.color} art={a.art} size={30}
                result={c.result ? (a.winner === c.result.winner ? "right" : "wrong") : undefined} />
            ))}
            {!c.calls.length && <span className="hint">Analysts pick a few hours before the game</span>}
          </div>
          <Link className="card-foot" href={`/match/${s.matchId}`}>Details →</Link>
        </div>
      </div>
    </article>
  );
}

