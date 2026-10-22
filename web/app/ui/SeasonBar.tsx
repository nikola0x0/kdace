// The live season as a stage stepper: every stage of Worlds as one step with its dates. Finished stages are checked,
// the current one is lit with a progress bar through its days, and the Final carries the trophy.
import { Check, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEASON, stageIndex } from "../../lib/season";
import { schedule } from "../../lib/site";

const DAY = 86_400_000;
const day = (iso: string) => Math.floor(Date.parse(iso) / DAY);
const fmt = (d: number) => new Date(d * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const range = (from: number, to: number) => (to - from <= 1 ? fmt(from) : `${fmt(from)} – ${fmt(to - 1)}`);

export default async function SeasonBar() {
  const all = await schedule();
  if (!all.length) return null;
  const today = Date.now() / DAY;
  const stages = SEASON.stages.flatMap((name, i) => {
    const days = all.filter((s) => stageIndex(s.block) === i).map((s) => day(s.startTime));
    if (!days.length) return [];
    const from = Math.min(...days), to = Math.max(...days) + 1;
    return [{ name, from, to, progress: Math.max(0, Math.min(1, (today - from) / (to - from))) }];
  });
  const currentIdx = Math.max(0, stages.findIndex((s) => today < s.to));

  return (
    <div className="border-b border-border bg-black">
      <div className="wrap flex items-center gap-6 py-3 max-md:flex-col max-md:items-stretch max-md:gap-2">
        <span className="shrink-0 font-display text-xl font-black uppercase leading-none tracking-wide">{SEASON.name}</span>
        <ol className="flex flex-1 items-stretch gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {stages.map((s, i) => {
            const done = i < currentIdx, now = i === currentIdx, final = i === stages.length - 1;
            const starts = now && s.progress === 0;
            return (
              <li
                key={s.name}
                className={cn(
                  "relative flex min-w-[112px] flex-1 flex-col justify-center gap-0.5 overflow-hidden rounded-md border px-3 py-1.5",
                  now ? "border-white/25 bg-white/[0.06]" : "border-transparent",
                )}
              >
                <span className={cn("flex items-center gap-1.5 text-[13px] font-semibold", now ? "text-white" : done ? "text-neutral-400" : "text-neutral-500")}>
                  {done && <Check className="size-3.5 text-win" strokeWidth={3} />}
                  {final && <Trophy className={cn("size-3.5", now ? "text-amber-300" : "text-neutral-500")} />}
                  {s.name}
                </span>
                <span className={cn("text-[11px] tabular-nums", now ? "text-neutral-300" : "text-neutral-600")}>
                  {starts ? `Starts ${fmt(s.from)}` : now ? `Day ${Math.floor(today - s.from) + 1} of ${s.to - s.from}` : range(s.from, s.to)}
                </span>
                {now && (
                  <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
                    <span className="block h-full bg-win" style={{ width: `${Math.max(3, s.progress * 100)}%` }} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
