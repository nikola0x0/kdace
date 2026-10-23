// Pre-game trash talk between the analysts who picked opposite sides (flavour only, not part of the locked picks).
import type { Banter } from "../../../src/core/banter.ts";
import { persona, shortName } from "../../lib/personas";
import { art } from "../../lib/site";
import { Avatar } from "./bits";

export default function TrashTalk({ banter, picks }: { banter: Banter; picks: Record<string, string> }) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-base font-bold">Trash talk</h3>
        <span className="text-xs text-muted-foreground">They didn&apos;t agree on this one</span>
      </div>
      <ul className="grid gap-3">
        {banter.comments.map((c, i) => {
          const p = persona(`analyst-${c.by}`);
          if (!p) return null;
          const to = c.replyTo !== null ? persona(`analyst-${banter.comments[c.replyTo].by}`) : null;
          return (
            <li key={i} className={c.replyTo !== null ? "ml-6 border-l border-border pl-3" : ""}>
              <div className="flex gap-2.5">
                <Avatar name={p.name} color={p.color} art={art(`analyst-${p.role}`)} size={28} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <b className="text-sm" style={{ color: p.color }}>{shortName(p)}</b>
                    <span className="text-muted-foreground">on {picks[p.player]}</span>
                    {to && <span className="text-muted-foreground">↳ {shortName(to)}</span>}
                  </div>
                  <p className="m-0 text-sm leading-snug">{c.text}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
