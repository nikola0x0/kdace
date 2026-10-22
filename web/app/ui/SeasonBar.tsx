// The live season: each Worlds stage with its first and last scheduled game, rendered by SeasonStepper in the
// viewer's own timezone (and collapsible).
import { SEASON, stageIndex } from "../../lib/season";
import { schedule } from "../../lib/site";
import SeasonStepper, { type Stage } from "./SeasonStepper";

export default async function SeasonBar() {
  const all = await schedule();
  const stages: Stage[] = SEASON.stages.flatMap((name, i) => {
    const times = all.filter((s) => stageIndex(s.block) === i).map((s) => s.startTime).sort();
    return times.length ? [{ name, first: times[0], last: times[times.length - 1] }] : [];
  });
  if (!stages.length) return null;
  return <SeasonStepper season={SEASON.name} stages={stages} />;
}
