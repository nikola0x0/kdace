"use client";
// "Verify" for anyone: runs the checks in the viewer's browser against Sui directly and shows each one.
import { Check as CheckIcon, Loader2, Minus, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { verifySeries, type Check, type VerifyInput } from "../../lib/verify";
import { useFans } from "./FanProvider";

export default function VerifyButton({ input, title, compact = false }: { input: Omit<VerifyInput, "me">; title: string; compact?: boolean }) {
  const { me } = useFans();
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);

  async function run() {
    setOpen(true);
    setChecks(null);
    setChecks(await verifySeries({ ...input, me: me?.address ?? null }));
  }

  const passed = checks?.filter((c) => c.ok === true).length ?? 0;
  const failed = checks?.some((c) => c.ok === false);

  return (
    <>
      <button onClick={run} className={cn("inline-flex items-center gap-1.5 rounded-full border border-input px-3 font-semibold transition-colors hover:border-neutral-500", compact ? "h-7 text-xs" : "h-9 text-sm")}>
        <ShieldCheck className="size-4 text-win" /> Verify
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-4 border-border bg-[#0b0b0b] p-6 sm:max-w-[460px]">
          <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
          <DialogDescription>These checks run in your browser against the Sui {input.network} network directly, not KDAce&apos;s servers.</DialogDescription>
          <ul className="grid gap-2">
            {!checks && <li className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Reading Sui…</li>}
            {checks?.map((c) => (
              <li key={c.label} className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", c.ok === true ? "bg-win text-black" : c.ok === false ? "bg-loss text-black" : "bg-neutral-800 text-neutral-400")}>
                  {c.ok === true ? <CheckIcon className="size-3.5" strokeWidth={3} /> : c.ok === false ? <X className="size-3.5" strokeWidth={3} /> : <Minus className="size-3.5" />}
                </span>
                <span className="grid gap-0.5">
                  <span className="text-sm font-semibold">{c.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {checks && <p className={cn("text-sm font-semibold", failed ? "text-loss" : "text-win")}>{failed ? "Something doesn't match. Every link above leads to the on-chain record." : `All ${passed} checks passed.`}</p>}
          <div className="flex flex-wrap gap-2 text-xs">
            {input.commitDigest && <a className="rounded-full border border-input px-3 py-1 text-muted-foreground hover:text-foreground" href={`https://suiscan.xyz/${input.network}/tx/${input.commitDigest}`} target="_blank" rel="noreferrer">Analysts&apos; commit ↗</a>}
            {input.fansDigest && <a className="rounded-full border border-input px-3 py-1 text-muted-foreground hover:text-foreground" href={`https://suiscan.xyz/${input.network}/tx/${input.fansDigest}`} target="_blank" rel="noreferrer">Fans&apos; commit ↗</a>}
            {input.result && <a className="rounded-full border border-input px-3 py-1 text-muted-foreground hover:text-foreground" href={`https://suiscan.xyz/${input.network}/tx/${input.result.resultDigest}`} target="_blank" rel="noreferrer">Result ↗</a>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
