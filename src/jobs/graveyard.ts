// Graveyard stage (tick): for each team knocked out of Worlds whose last series has its lessons in, one farewell roast
// built from the analysts' own calls and lessons on that team. Best effort: a failed reply leaves the team for next run.
import { buildEulogyPrompt, needsEulogy, parseEulogy } from "../core/graveyard.ts";
import type { RecordStore } from "../core/store.ts";
import type { Series } from "../core/worlds.ts";

export type GraveyardDeps = { store: RecordStore; fetchSeries(): Promise<Series[]>; ask(prompt: string): Promise<string>; now(): Date; log(msg: string): void };

/** At most `limit` threads per run, oldest exit first. Returns the teams written and why any were skipped. */
export async function runGraveyard(deps: GraveyardDeps, limit = 1): Promise<{ done: string[]; skipped: Record<string, string> }> {
  const [schedule, records, graveyard] = await Promise.all([deps.fetchSeries(), deps.store.all(), deps.store.readGraveyard()]);
  const done: string[] = [];
  const skipped: Record<string, string> = {};
  for (const k of needsEulogy(schedule, records, graveyard).slice(0, limit)) {
    try {
      const eulogy = parseEulogy(await deps.ask(buildEulogyPrompt(k, records)), k, records, deps.now());
      await deps.store.writeGraveyard({ ...(await deps.store.readGraveyard()), [k.team]: eulogy });
      done.push(k.team);
    } catch (e) {
      skipped[k.team] = (e as Error).message.slice(0, 200);
      deps.log(`${k.team} roast skipped: ${skipped[k.team]}`);
    }
  }
  return { done, skipped };
}
