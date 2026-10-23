// "Who wins Worlds?": today's title call from each analyst (locked on Sui), with the consensus team up front.
import Link from "next/link";
import type { TitleDay } from "../../../src/core/titles.ts";
import { persona } from "../../lib/personas";
import { art, suiscan } from "../../lib/site";
import { Avatar, RoleIcon, TeamLogo } from "./bits";

export default function TitleRace({ day, logos }: { day: TitleDay; logos: Record<string, string> }) {
  const votes = new Map<string, { n: number; prob: number }>();
  for (const p of day.picks) {
    const v = votes.get(p.champion) ?? { n: 0, prob: 0 };
    votes.set(p.champion, { n: v.n + 1, prob: v.prob + p.probability });
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1].n - a[1].n || b[1].prob - a[1].prob);
  const [fav, favVotes] = ranked[0];

  return (
    <section className="section">
      <div className="section-head">
        <h2>Who wins Worlds?</h2>
        <a href={suiscan(day, day.commitDigest)} target="_blank" rel="noreferrer">Today&apos;s calls locked on Sui ↗</a>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
        <div className="relative grid content-between gap-6 overflow-hidden rounded-[var(--radius)] border border-border bg-card p-5">
          <div className="pointer-events-none absolute -right-10 -bottom-10 size-56 opacity-[0.08]" aria-hidden>
            {logos[fav] && <img src={logos[fav]} alt="" className="size-full object-contain" />}
          </div>
          <div className="relative grid gap-1">
            <span className="text-xs text-muted-foreground">The AI favourite</span>
            <div className="flex items-center gap-3">
              <span className="[&_.tlogo]:size-14"><TeamLogo code={fav} logo={logos[fav] ?? null} /></span>
              <span className="display text-6xl leading-none">{fav}</span>
            </div>
            <span className="text-sm text-muted-foreground">{favVotes.n} of {day.picks.length} analysts · {Math.round(favVotes.prob / favVotes.n)}% average chance</span>
          </div>
          {ranked.length > 1 && (
            <div className="relative flex flex-wrap gap-2">
              {ranked.slice(1).map(([team, v]) => (
                <span key={team} className="flex items-center gap-1.5 rounded-full border border-border bg-secondary py-1 pr-2.5 pl-1 text-xs font-semibold [&_.tlogo]:size-5">
                  <TeamLogo code={team} logo={logos[team] ?? null} />{team}<span className="font-normal text-muted-foreground">{v.n}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <ul className="grid gap-2">
          {day.picks.map((pick) => {
            const p = persona(pick.player);
            if (!p) return null;
            return (
              <li key={pick.player} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-3 py-2.5">
                <Link href={`/analysts/${p.role}`}><Avatar name={p.name} color={p.color} art={art(`analyst-${p.role}`)} size={36} /></Link>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold"><RoleIcon role={p.role} size={14} />{p.name}</div>
                  <p className="line-clamp-2 text-xs text-muted-foreground" title={pick.reasoning}>{pick.reasoning}</p>
                </div>
                <div className="grid justify-items-end gap-1">
                  <span className="flex items-center gap-1.5 font-bold [&_.tlogo]:size-6"><TeamLogo code={pick.champion} logo={logos[pick.champion] ?? null} />{pick.champion}</span>
                  <span className="relative h-1 w-20 overflow-hidden rounded-full bg-secondary" title={`${pick.probability}% chance to win Worlds`}>
                    <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pick.probability}%`, background: p.color }} />
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">{pick.probability}%{pick.contenders.length ? ` · then ${pick.contenders.join(", ")}` : ""}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
