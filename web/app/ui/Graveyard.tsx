// The Graveyard: every team knocked out of Worlds, roasted by the analysts from their own calls and Walrus lessons on it
// (flavour only, not part of the locked picks). Newest exit first; each thread shows two comments, the rest on a click.
import type { Eulogy, EulogyComment } from "../../../src/core/graveyard.ts";
import { persona, shortName } from "../../lib/personas";
import { art, walruscan } from "../../lib/site";
import { Avatar, TeamLogo } from "./bits";
import LocalTime from "./LocalTime";

function Comment({ c, all }: { c: EulogyComment; all: EulogyComment[] }) {
  const p = persona(`analyst-${c.by}`);
  if (!p) return null;
  const to = c.replyTo !== null ? persona(`analyst-${all[c.replyTo].by}`) : null;
  return (
    <li className={c.replyTo !== null ? "ml-6 border-l border-border pl-3" : ""}>
      <div className="flex gap-2.5">
        <Avatar name={p.name} color={p.color} art={art(`analyst-${p.role}`)} size={26} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <b className="text-sm" style={{ color: p.color }} translate="no">{shortName(p)}</b>
            {to && <span className="text-muted-foreground" translate="no">↳ {shortName(to)}</span>}
            {c.lesson && (
              <a href={walruscan(c.lesson.blobId)} target="_blank" rel="noreferrer" title={c.lesson.text} className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground">
                from a lesson on Walrus ↗
              </a>
            )}
          </div>
          <p className="m-0 text-sm leading-snug">{c.text}</p>
        </div>
      </div>
    </li>
  );
}

export default function Graveyard({ teams, logos }: { teams: Eulogy[]; logos: Record<string, string> }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>The Graveyard</h2>
        <span className="text-xs text-muted-foreground">Knocked out, then roasted from what the analysts learned</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {teams.map((e) => {
          const [first, rest] = [e.comments.slice(0, 2), e.comments.slice(2)];
          return (
            <article key={e.team} className="grid content-start gap-4 rounded-[var(--radius)] border border-border bg-card p-4">
              <header className="flex items-center gap-3">
                <span className="opacity-60 grayscale [&_.tlogo]:size-11"><TeamLogo code={e.team} logo={logos[e.team] ?? null} /></span>
                <div className="grid min-w-0 gap-0.5">
                  <span className="display text-3xl leading-none text-muted-foreground line-through decoration-2" translate="no">{e.team}</span>
                  <span className="text-xs text-muted-foreground">
                    <b className="tabular-nums text-foreground">{e.record.w}–{e.record.l}</b> · out to <b className="text-foreground" translate="no">{e.out.by}</b> in the {e.out.block} · <LocalTime iso={e.out.at} format="date" />
                  </span>
                </div>
              </header>
              <ul className="m-0 grid list-none gap-3 p-0">
                {first.map((c, i) => <Comment key={i} c={c} all={e.comments} />)}
              </ul>
              {rest.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer list-none text-xs font-semibold text-muted-foreground hover:text-foreground group-open:hidden">
                    Read {rest.length} more
                  </summary>
                  <ul className="m-0 grid list-none gap-3 p-0">
                    {rest.map((c, i) => <Comment key={i} c={c} all={e.comments} />)}
                  </ul>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
