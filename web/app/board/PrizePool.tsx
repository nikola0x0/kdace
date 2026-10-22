"use client";
// Sponsorship invite on the leaderboard: no prize pool exists yet; sponsors get in touch by email.
import { Handshake, Mail, Trophy } from "lucide-react";
import { PAYOUT_TIERS, SPONSOR_EMAIL, SPONSOR_MAILTO } from "../../lib/prizes";

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

export default function PrizePool() {
  return (
    <section aria-labelledby="sponsor-title" className="mb-5 overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <div className="grid md:grid-cols-[1.05fr_1fr]">
        <div className="relative grid content-start gap-5 border-b border-border p-5 md:border-r md:border-b-0 md:p-6">
          <div className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-win/10 blur-3xl" aria-hidden />
          <span className="eyebrow relative flex items-center gap-1.5"><Trophy className="size-3.5 text-win" /> Season sponsor</span>
          <div className="relative grid gap-2">
            <h2 id="sponsor-title" className="display text-5xl leading-[0.9] md:text-6xl">Back the best callers of Worlds</h2>
            <p className="max-w-md text-sm text-muted-foreground">Put your brand on the leaderboard and reward the top 20 fans of the season. Prizes, gear, anything that fits. Get in touch and we&apos;ll set it up together.</p>
          </div>
          <div className="relative flex flex-wrap items-center gap-3">
            <a className="btn" href={SPONSOR_MAILTO}><Handshake className="size-4" /> Become a sponsor</a>
            <a className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground" href={SPONSOR_MAILTO}><Mail className="size-3.5" />{SPONSOR_EMAIL}</a>
          </div>
        </div>

        <div className="grid content-start gap-3 p-5 md:p-6">
          <div className="grid grid-cols-[1fr_auto] gap-x-6 border-b border-border pb-2 text-xs font-semibold text-muted-foreground">
            <span>How a prize pool would be split</span><span className="text-right">Share</span>
          </div>
          <ol className="grid gap-0.5">
            {PAYOUT_TIERS.map((t) => (
              <li key={t.label} className="grid grid-cols-[1fr_auto] items-center gap-x-6 py-1.5">
                <span className="flex items-center gap-2 font-semibold">
                  <span className={t.from <= 3 ? "display text-lg" : "text-sm"}>{t.label}</span>
                  {t.to > t.from && <span className="text-xs font-normal text-muted-foreground">each</span>}
                </span>
                <b className="num text-right tabular-nums">{pct(t.bps)}</b>
              </li>
            ))}
          </ol>
          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">Top 20 fans by Total (balance + in play), ties by profit. AI analysts play for pride and never take a prize place.</p>
        </div>
      </div>
    </section>
  );
}
