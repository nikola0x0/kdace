"use client";
// The bet slip: pick a side, set an AXP amount, see what it would return from the current pool, confirm.
// Side panel on desktop, bottom sheet on phones.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { teamColor } from "../../lib/teams";
import { Axp, TeamLogo } from "./bits";
import Countdown from "./Countdown";
import { useFans, type Market } from "./FanProvider";

const SCORES: Record<number, string[]> = { 1: [], 3: ["2-0", "2-1"], 5: ["3-0", "3-1", "3-2"] };
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export default function BetSlip() {
  const { slip, closeSlip, open, available, placeBet } = useFans();
  const [market, setMarket] = useState<Market>(slip!.market);
  const [choice, setChoice] = useState(slip!.choice);
  const live = open[slip!.match.matchId];
  const [stake, setStake] = useState<number>(100);
  const [busy, setBusy] = useState(false);
  const m = slip!.match;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeSlip();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSlip]);

  const max = available;
  // What you already hold on each outcome of this market; a buy adds to it.
  const held = live?.mine[market] ?? {};
  const position = held[choice] ?? 0;
  const options = market === "winner" ? [m.teamA, m.teamB] : SCORES[m.bestOf];

  // Parimutuel estimate if the market closed now: your share of the whole pool, by stake on your side.
  const est = useMemo(() => {
    const fanPool = (market === "winner" ? live?.crowd.winnerPool : live?.crowd.scorePool) ?? {};
    const ai = market === "winner" ? m.aiPool : {};
    const pool: Record<string, number> = {};
    for (const o of options) pool[o] = (fanPool[o] ?? 0) + (ai[o] ?? 0);
    // The pool already includes your current position; after the buy your whole position is paid from the bigger pool.
    const total = Object.values(pool).reduce((a, b) => a + b, 0) + stake;
    const side = (pool[choice] ?? 0) + stake;
    const after = position + stake;
    const ret = after > 0 ? Math.floor((after / side) * total) : 0;
    return { ret, after, mult: after > 0 ? ret / after : 0, pool };
  }, [live, market, m.aiPool, options, stake, choice, position]);

  const valid = Number.isInteger(stake) && stake >= 10 && stake <= max;
  const vars = { "--ta": teamColor(m.teamA), "--tb": teamColor(m.teamB) } as CSSProperties;
  const lockAt = live?.lockAt;

  async function confirm() {
    if (!valid) return;
    setBusy(true);
    const ok = await placeBet(m.matchId, market, choice, stake);
    setBusy(false);
    if (ok) closeSlip();
  }

  return (
    <div className="slip-overlay" onClick={closeSlip}>
      <aside className="slip" style={vars} role="dialog" aria-modal="true" aria-label="Bet slip" onClick={(e) => e.stopPropagation()}>
        <div className="slip-head">
          <span className="ap-label">{m.block} · Bo{m.bestOf}</span>
          {lockAt && <Countdown lockAt={lockAt} />}
          <button className="slip-x" onClick={closeSlip} aria-label="Close">×</button>
        </div>
        <div className="slip-match">
          <span><TeamLogo code={m.teamA} logo={m.logoA} /><b className="display">{m.teamA}</b></span>
          <span className="vs">vs</span>
          <span><b className="display">{m.teamB}</b><TeamLogo code={m.teamB} logo={m.logoB} /></span>
        </div>

        {m.bestOf > 1 && (
          <div className="seg">
            {(["winner", "score"] as const).map((k) => (
              <button key={k} className={market === k ? "on" : ""} onClick={() => { setMarket(k); setChoice(k === "winner" ? m.teamA : SCORES[m.bestOf][0]); }}>
                {k === "winner" ? "Winner" : "Exact score"}
              </button>
            ))}
          </div>
        )}

        <div className="slip-options">
          {options.map((o) => {
            const tot = Object.values(est.pool).reduce((a, b) => a + b, 0);
            const share = tot ? Math.round(((est.pool[o] ?? 0) / tot) * 100) : null;
            const tone = market === "winner" ? (o === m.teamA ? "a" : "b") : "n";
            return (
              <button key={o} className={`slip-opt ${tone} ${choice === o ? "on" : ""}`} onClick={() => setChoice(o)}>
                <b>{o}</b>
                <span className="num">{share === null ? "no bets yet" : `${share}% of pool`}</span>
                {held[o] ? <span className="held num">You hold {fmt(held[o])}</span> : null}
              </button>
            );
          })}
        </div>

        <label className="slip-amount">
          <span className="ap-label">Amount</span>
          <div className="amount-box">
            <input type="number" inputMode="numeric" min={10} max={max} step={10} value={stake || ""} onChange={(e) => setStake(Math.floor(Number(e.target.value) || 0))} />
            <Axp size={26} />
          </div>
        </label>
        <div className="quick">
          {[100, 500, 1000].map((q) => <button key={q} onClick={() => setStake((s) => Math.min(max, (s || 0) + q))}>+{fmt(q)}</button>)}
          <button onClick={() => setStake(max)}>Max</button>
        </div>

        <div className="slip-sum">
          <div><span>Available</span><b className="num">{fmt(max)} AXP</b></div>
          {position > 0 && <div><span>Your position on {choice}</span><b className="num">{fmt(position)} → {valid ? fmt(est.after) : fmt(position)} AXP</b></div>}
          <div><span>Payout if {choice} wins (if it closed now)</span><b className="num win">{valid ? `${fmt(est.ret)} AXP` : "-"}</b></div>
          <div><span>Multiplier</span><b className="num">{valid ? `${est.mult.toFixed(2)}×` : "-"}</b></div>
        </div>

        <button className="btn slip-go" disabled={!valid || busy} onClick={confirm}>
          {busy ? "Buying…" : `Buy ${fmt(stake)} AXP of ${choice}`}
        </button>
        <p className="slip-note">
          {stake > max ? `You only have ${fmt(max)} AXP available.` : stake < 10 ? "Minimum bet is 10 AXP." : "Each buy adds to your position. Winners split the pool by stake. Buying closes 5 minutes before the game; positions are proven on Sui."}
        </p>
        <p className="slip-note dim">AXP is play money with no cash value.</p>
      </aside>
    </div>
  );
}
