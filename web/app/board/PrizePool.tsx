"use client";
// Season prize pool panel: a preview of how sponsored prizes would work. Nothing is live and no money moves.
import { useState } from "react";
import { Handshake, Lock, Mail, Plus, ShieldCheck, Trophy } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PAYOUT_TIERS, PREVIEW_POOL_CENTS, SPONSOR_MAILTO, SPONSOR_SLOTS, SPONSORS, usd } from "../../lib/prizes";

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

export default function PrizePool() {
  const [open, setOpen] = useState(false);
  const openSlots = Math.max(0, SPONSOR_SLOTS - SPONSORS.length);

  return (
    <section aria-labelledby="prize-pool-title" className="mb-5 overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <div className="grid gap-0 md:grid-cols-[1.05fr_1fr]">
        {/* Left: pool total, sponsors, call to action */}
        <div className="relative grid content-start gap-5 border-b border-border p-5 md:border-r md:border-b-0 md:p-6">
          <div className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-win/10 blur-3xl" aria-hidden />
          <div className="relative flex flex-wrap items-center gap-2">
            <span className="eyebrow flex items-center gap-1.5"><Trophy className="size-3.5 text-win" /> Season prize pool</span>
            <span className="rounded-full border border-dashed border-win/50 px-2 py-0.5 text-[11px] font-semibold text-win">Preview · prizes not live yet</span>
          </div>

          <div className="relative grid gap-1">
            <h2 id="prize-pool-title" className="display text-6xl leading-[0.9] tabular-nums md:text-7xl">{usd(PREVIEW_POOL_CENTS)}</h2>
            <p className="text-sm text-muted-foreground">Showcase figure for the Worlds 2026 season. Paid to the top 20 fans on the board, held on Sui until the final.</p>
          </div>

          <div className="relative grid gap-2">
            <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Prize pool by</span>
            <div className="grid grid-cols-3 gap-2">
              {SPONSORS.map((s) => (
                <div key={s.name} className="flex h-14 items-center justify-center rounded-lg border border-border bg-secondary px-2 text-center text-sm font-semibold">
                  {s.logo ? <img src={s.logo} alt={s.name} className="max-h-8 max-w-full object-contain" /> : s.name}
                </div>
              ))}
              {Array.from({ length: openSlots }, (_, i) => (
                <button key={i} type="button" onClick={() => setOpen(true)} className="flex h-14 items-center justify-center gap-1 rounded-lg border border-dashed border-input text-xs text-muted-foreground transition-colors hover:border-neutral-500 hover:text-foreground">
                  <Plus className="size-3.5" /> Open slot
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex flex-wrap items-center gap-3">
            <button type="button" className="btn" onClick={() => setOpen(true)}><Handshake className="size-4" /> Become a sponsor</button>
            <span className="text-xs text-muted-foreground">AI analysts play for pride: they never take a prize place.</span>
          </div>
        </div>

        {/* Right: payout table */}
        <div className="grid content-start gap-3 p-5 md:p-6">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 border-b border-border pb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            <span>Place</span><span className="text-right">Share</span><span className="w-20 text-right">Prize</span>
          </div>
          <ol className="grid gap-0.5">
            {PAYOUT_TIERS.map((t) => (
              <li key={t.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 rounded-md py-1.5">
                <span className="flex items-center gap-2 font-semibold">
                  <span className={t.from <= 3 ? "display text-lg" : "text-sm"}>{t.label}</span>
                  {t.to > t.from && <span className="text-xs font-normal text-muted-foreground">each</span>}
                </span>
                <span className="text-right text-sm tabular-nums text-muted-foreground">{pct(t.bps)}</span>
                <b className="num w-20 text-right tabular-nums">{usd(t.cents)}</b>
              </li>
            ))}
          </ol>
          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            Ranked by Total (balance + in play), ties by profit. Fewer than 20 fans on the board? Unpaid shares are split across the paid places in proportion to their share, and any rounding goes to 1st. Projected prizes show next to the top 20 below.
          </p>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="dialog gap-4 border-border bg-[#0b0b0b] p-6 sm:max-w-[440px]">
          <DialogTitle className="text-xl font-bold tracking-tight">Sponsor the season prize pool</DialogTitle>
          <DialogDescription>Put your name on the Worlds 2026 board and reward the fans who call it best. This is a preview: sponsorships aren&apos;t open yet.</DialogDescription>
          <ul className="grid gap-3 text-sm">
            <li className="flex gap-3"><Lock className="mt-0.5 size-4 shrink-0 text-win" /><span><b>Funds are held on Sui.</b> Your contribution sits in a public prize pool with your name on it, untouched until the end of the season.</span></li>
            <li className="flex gap-3"><Trophy className="mt-0.5 size-4 shrink-0 text-win" /><span><b>Paid in one transaction after the Worlds final.</b> The top 20 fans get their share at once, using the payout table on this page.</span></li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-win" /><span><b>Everyone can verify the ranking.</b> Every pick is fingerprinted and locked before the game starts, so anyone can recompute the board and check who was paid.</span></li>
          </ul>
          <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Any real prizes would run under published official rules (18+, void where prohibited). AXP itself stays play money and can&apos;t be bought.</p>
          <div className="flex flex-wrap gap-2">
            <a className="btn" href={SPONSOR_MAILTO}><Mail className="size-4" /> Get in touch</a>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Not now</button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
