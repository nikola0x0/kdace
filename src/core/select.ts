// Which series to pick now, which ones were missed, which interrupted commits to resume, and which ones to settle.
import type { SeriesRecord, Store } from "./store.ts";
import type { Series } from "./worlds.ts";

/** Picks lock 5 minutes before the scheduled start, so a commit never lands after the game begins. */
export const LOCK_MARGIN_MS = 5 * 60 * 1000;

export const isLocked = (startTime: string, now: Date) => now.getTime() >= Date.parse(startTime) - LOCK_MARGIN_MS;

const teamsKnown = (s: Series) => s.teamA !== "TBD" && s.teamB !== "TBD";

export function seriesToPick(all: Series[], store: Store, now: Date): { pick: Series[]; missed: Series[] } {
  const open = all.filter((s) => teamsKnown(s) && !store.get(s.matchId));
  return {
    pick: open.filter((s) => s.state === "unstarted" && !isLocked(s.startTime, now)),
    missed: open.filter((s) => isLocked(s.startTime, now)),
  };
}

/** Records whose commit was interrupted: re-submit the same hash while there is still time. */
export function seriesToResume(store: Store, now: Date): SeriesRecord[] {
  return store.all().filter((r) => r.status === "committing" && !isLocked(r.series.startTime, now));
}

/** Committed series, plus series the analysts missed but the fans committed. */
export function seriesToSettle(all: Series[], store: Store): Series[] {
  return all.filter((s) => {
    const r = s.state === "completed" ? store.get(s.matchId) : null;
    return r?.status === "committed" || (r?.status === "missed" && r.fans?.status === "committed");
  });
}
