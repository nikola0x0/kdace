// The live season as a tournament timeline: one track from the first Play-In day to the Final, each stage a
// segment sized by its real dates, filled up to today with a ragged dither edge where the tournament is now.
import type { CSSProperties } from "react";
import { SEASON, stageIndex } from "../../lib/season";
import { schedule } from "../../lib/site";

const DAY = 86_400_000;
// The knockout stages are only a few days wide on the track, so they get short labels.
const LABEL: Record<string, string> = { Quarterfinals: "QF", Semifinals: "SF" };
const day = (iso: string) => Math.floor(Date.parse(iso) / DAY);
const short = (d: number) => new Date(d * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function SeasonBar() {
  const all = await schedule();
  if (!all.length) return null;
  // Each stage spans its first to last scheduled day (inclusive).
  const spans = SEASON.stages.map((name, i) => {
    const days = all.filter((s) => stageIndex(s.block) === i).map((s) => day(s.startTime));
    return days.length ? { name, from: Math.min(...days), to: Math.max(...days) + 1 } : null;
  });
  const known = spans.filter((x): x is NonNullable<typeof x> => !!x);
  const start = known[0].from, end = known[known.length - 1].to, total = end - start;
  const today = Date.now() / DAY;
  const current = known.find((s) => today < s.to) ?? known[known.length - 1];
  const where = today < current.from ? `${current.name} starts ${short(current.from)}` : `${current.name} stage, ${short(current.from)} – ${short(current.to - 1)}`;

  return (
    <div className="season">
      <div className="wrap season-row">
        <div className="season-title">
          <b className="display">{SEASON.name}</b>
          <span>{where}</span>
        </div>
        <div className="track" role="img" aria-label={`${SEASON.name}: ${where}`}>
          {known.map((s) => {
            const fill = Math.max(0, Math.min(1, (today - s.from) / (s.to - s.from)));
            const style = { left: `${((s.from - start) / total) * 100}%`, width: `${((s.to - s.from) / total) * 100}%`, "--fill": `${fill * 100}%` } as CSSProperties;
            const state = fill >= 1 ? "done" : fill > 0 ? "now" : today >= s.from - 0.01 && s === current ? "now" : "";
            return (
              <div key={s.name} className={`tl-seg ${state} ${s === current ? "current" : ""}`} style={style} title={s.name}>
                <i />
                <span>{LABEL[s.name] ?? s.name}</span>
              </div>
            );
          })}
        </div>
        <span className="season-next">More leagues after Worlds</span>
      </div>
    </div>
  );
}
