"use client";
// Live buys from other players, one small pop-up at a time in the bottom-left corner. Only buys that happen while
// the page is open are shown; the first poll just sets the starting point.
import { useEffect, useRef, useState } from "react";
import { Axp } from "./bits";
import { useFans } from "./FanProvider";

type Buy = { id: number; matchId: string; choice: string; amount: number; name: string; avatarUrl: string | null; address: string };

export default function ActivityToasts() {
  const { open, me } = useFans();
  const [shown, setShown] = useState<Buy | null>(null);
  const queue = useRef<Buy[]>([]);
  const last = useRef<number | null>(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/activity", { cache: "no-store" });
        if (!r.ok) return;
        const { buys } = (await r.json()) as { buys: Buy[] };
        const top = buys[0]?.id ?? 0;
        if (last.current === null) last.current = top;
        else {
          queue.current.push(...buys.filter((b) => b.id > last.current! && b.address !== me?.address).reverse());
          last.current = Math.max(last.current, top);
        }
      } catch {}
    };
    poll();
    const t = setInterval(() => !stop && document.visibilityState === "visible" && poll(), 12_000);
    return () => { stop = true; clearInterval(t); };
  }, [me?.address]);

  // Show queued buys one at a time.
  useEffect(() => {
    const t = setInterval(() => {
      if (!shown && queue.current.length) setShown(queue.current.shift()!);
    }, 600);
    return () => clearInterval(t);
  }, [shown]);
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 4200);
    return () => clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  const s = open[shown.matchId]?.series as { teamA?: string; teamB?: string } | undefined;
  return (
    <div role="status" className="fixed bottom-5 left-5 z-40 flex max-w-[340px] items-center gap-3 rounded-xl border border-border bg-[#0d0d0d]/95 px-3.5 py-2.5 shadow-2xl backdrop-blur animate-in fade-in slide-in-from-bottom-2 max-md:bottom-[84px] max-md:left-3">
      {shown.avatarUrl ? <img src={shown.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full object-cover" /> : <span className="grid size-8 place-items-center rounded-full bg-secondary text-[11px] font-bold text-muted-foreground">{shown.name.replace(/^0x/, "").slice(0, 2).toUpperCase()}</span>}
      <span className="grid text-[13px] leading-snug">
        <span><b>{shown.name}</b> bought <span className="inline-flex items-center gap-1 font-bold tabular-nums"><Axp size={13} />{shown.amount.toLocaleString("en-US")}</span> of <b>{shown.choice}</b></span>
        {s?.teamA && <span className="text-xs text-muted-foreground">{s.teamA} vs {s.teamB}</span>}
      </span>
    </div>
  );
}
