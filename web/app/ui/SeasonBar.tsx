// The live season under the header: name, stage progress, and the competitions coming next.
import { SEASON, stageIndex } from "../../lib/season";
import { schedule } from "../../lib/site";

export default async function SeasonBar() {
  const all = await schedule();
  const next = all.find((s) => s.state !== "completed");
  const current = stageIndex(next?.block ?? all.at(-1)?.block);
  return (
    <div className="season">
      <div className="wrap season-row">
        <span className="season-live"><i />Live season</span>
        <b className="season-name display">{SEASON.name}</b>
        <ol className="season-stages">
          {SEASON.stages.map((st, i) => (
            <li key={st} className={i < current ? "done" : i === current ? "now" : ""}>{i < current ? "✓ " : ""}{st}</li>
          ))}
        </ol>
        <span className="season-next">Next: {SEASON.next.join(" · ")}</span>
      </div>
    </div>
  );
}
