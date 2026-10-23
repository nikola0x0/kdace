// Banter stage (tick): for each committed series the analysts split on, one comment thread of trash talk before the
// game. Best effort: a failed or unusable reply just leaves the series without a thread until the next run.
import { buildBanterPrompt, needsBanter, parseBanter } from "../core/banter.ts";
import { isLocked } from "../core/select.ts";
import type { RecordStore } from "../core/store.ts";

export type BanterDeps = { store: RecordStore; ask(prompt: string): Promise<string>; now(): Date; log(msg: string): void };

/** At most `limit` threads per run, so one tick never spends long here. */
export async function runBanter(deps: BanterDeps, limit = 4): Promise<string[]> {
  const done: string[] = [];
  const todo = (await deps.store.all()).filter((r) => needsBanter(r) && !isLocked(r.series.startTime, deps.now())).sort((a, b) => a.series.startTime.localeCompare(b.series.startTime));
  for (const r of todo.slice(0, limit)) {
    try {
      const banter = parseBanter(await deps.ask(buildBanterPrompt(r)), r, deps.now());
      await deps.store.put({ ...(await deps.store.get(r.series.matchId))!, banter });
      done.push(r.series.matchId);
    } catch (e) {
      deps.log(`${r.series.matchId} banter skipped: ${(e as Error).message}`);
    }
  }
  return done;
}

export async function realBanterDeps(store: RecordStore): Promise<BanterDeps> {
  const { askAnalyst } = await import("../core/llm.ts");
  return { store, ask: askAnalyst, now: () => new Date(), log: (m) => console.log(`[banter] ${m}`) };
}
