"use client";
// Stage stepper in the viewer's timezone: finished stages checked, the current one lit with a progress bar through its
// days, the Final with the trophy. Collapses to a one-line strip; the choice is remembered on this device.
import { Check, ChevronDown, ChevronUp, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type Stage = { name: string; first: string; last: string };

const KEY = "kdace.season.collapsed";
const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export default function SeasonStepper({ season, stages }: { season: string; stages: Stage[] }) {
  const [now, setNow] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    try { setCollapsed(localStorage.getItem(KEY) === "1"); } catch {}
  }, []);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(KEY, c ? "0" : "1"); } catch {}
    return !c;
  });

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const DAY = 86_400_000;
  const view = stages.map((s) => {
    const from = dayOf(new Date(s.first)), to = dayOf(new Date(s.last)) + DAY;
    const days = Math.round((to - from) / DAY);
    const progress = now === null ? 0 : Math.max(0, Math.min(1, (now - from) / (to - from)));
    return { ...s, from, to, days, progress };
  });
  const currentIdx = now === null ? -1 : Math.max(0, view.findIndex((s) => now < s.to));
  const current = view[currentIdx];
  const status = !current || now === null ? "" : current.progress === 0 ? `${current.name} starts ${fmt(current.first)}` : `${current.name}, day ${Math.floor((now - current.from) / DAY) + 1} of ${current.days}`;

  return (
    <div className="border-b border-border bg-black">
      <div className="wrap flex items-center gap-6 py-3 max-md:flex-col max-md:items-stretch max-md:gap-2" style={collapsed ? { paddingTop: 6, paddingBottom: 6 } : undefined}>
        <div className="flex shrink-0 items-center justify-between gap-3">
          <span className="font-display text-xl font-black uppercase leading-none tracking-wide">{season}</span>
          {collapsed && <span className="text-xs text-muted-foreground">{status}</span>}
        </div>
        {!collapsed && (
          <ol className="flex flex-1 items-stretch gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {view.map((s, i) => {
              const done = i < currentIdx, live = i === currentIdx, final = i === view.length - 1;
              return (
                <li key={s.name} className={cn("relative flex min-w-[112px] flex-1 flex-col justify-center gap-0.5 overflow-hidden rounded-md border px-3 py-1.5", live ? "border-white/25 bg-white/[0.06]" : "border-transparent")}>
                  <span className={cn("flex items-center gap-1.5 text-[13px] font-semibold", live ? "text-white" : done ? "text-neutral-400" : "text-neutral-500")}>
                    {done && <Check className="size-3.5 text-win" strokeWidth={3} />}
                    {final && <Trophy className={cn("size-3.5", live ? "text-amber-300" : "text-neutral-500")} />}
                    {s.name}
                  </span>
                  <span className={cn("text-[11px] tabular-nums", live ? "text-neutral-300" : "text-neutral-600")} suppressHydrationWarning>
                    {live && s.progress === 0 ? `Starts ${fmt(s.first)}` : live ? `Day ${Math.floor(((now ?? 0) - s.from) / DAY) + 1} of ${s.days}` : s.days <= 1 ? fmt(s.first) : `${fmt(s.first)} – ${fmt(s.last)}`}
                  </span>
                  {live && (
                    <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
                      <span className="block h-full bg-win" style={{ width: `${Math.max(3, s.progress * 100)}%` }} />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <button onClick={toggle} aria-label={collapsed ? "Show the season timeline" : "Hide the season timeline"} className={cn("grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-white/5 hover:text-foreground max-md:hidden", collapsed && "ml-auto")}>
          {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </button>
      </div>
    </div>
  );
}
