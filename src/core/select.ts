// Which series to pick now, which ones were missed, and which ones are ready to settle.
import type { Store } from "./store.ts";
import type { Series } from "./worlds.ts";

const teamsKnown = (s: Series) => s.teamA !== "TBD" && s.teamB !== "TBD";

export function seriesToPick(all: Series[], store: Store, now: Date): { pick: Series[]; missed: Series[] } {
  const open = all.filter((s) => teamsKnown(s) && !store.get(s.matchId));
  const started = (s: Series) => now.getTime() >= Date.parse(s.startTime);
  return {
    pick: open.filter((s) => s.state === "unstarted" && !started(s)),
    missed: open.filter(started),
  };
}

export function seriesToSettle(all: Series[], store: Store): Series[] {
  return all.filter((s) => s.state === "completed" && store.get(s.matchId)?.status === "committed");
}
