// Pick job: every analyst picks each open series blind, and the batch fingerprint is committed before the game.
import { pathToFileURL } from "node:url";
import { ANALYSTS, buildPickPrompt, parsePick, type AnalystPick, type Lesson, type Role } from "../core/analysts.ts";
import { batchHash, canonicalBatch, type BatchEntry } from "../core/batch.ts";
import { seriesToPick } from "../core/select.ts";
import { Store, type SeriesRecord } from "../core/store.ts";
import type { Series } from "../core/worlds.ts";

export type PickDeps = {
  fetchSeries(): Promise<Series[]>;
  store: Store;
  recall(role: Role, query: string): Promise<Lesson[]>;
  ask(prompt: string): Promise<string>;
  commit(matchId: string, hash: string, count: number): Promise<string>;
  history(): string[];
  now(): Date;
  log(msg: string): void;
};

const MIN_ANALYSTS = 3;

const emptyRecord = (series: Series, status: SeriesRecord["status"]): SeriesRecord => ({
  series, status, picks: [], batch: null, batchHash: null, commitDigest: null, result: null, points: null, debate: null, lessons: [],
});

async function analystPicks(deps: PickDeps, s: Series): Promise<AnalystPick[]> {
  const picks: AnalystPick[] = [];
  const history = deps.history();
  for (const a of ANALYSTS) {
    const lessons = await deps.recall(a.role, `Predicting ${s.teamA} vs ${s.teamB}, a Bo${s.bestOf} at Worlds`);
    const prompt = buildPickPrompt(a, s, lessons, history);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        picks.push(parsePick(await deps.ask(prompt), a, s, lessons, deps.now()));
        break;
      } catch (e) {
        deps.log(`${s.matchId} ${a.player} attempt ${attempt} invalid: ${(e as Error).message}`);
      }
    }
  }
  return picks;
}

export async function runPick(deps: PickDeps): Promise<{ committed: string[]; missed: string[] }> {
  const { pick, missed } = seriesToPick(await deps.fetchSeries(), deps.store, deps.now());
  const out = { committed: [] as string[], missed: [] as string[] };
  for (const s of missed) {
    deps.store.put(emptyRecord(s, "missed"));
    out.missed.push(s.matchId);
  }
  for (const s of pick) {
    const picks = await analystPicks(deps, s);
    if (picks.length < MIN_ANALYSTS) {
      deps.log(`${s.matchId} only ${picks.length} valid picks; not committing, will retry next run`);
      continue;
    }
    if (deps.now().getTime() >= Date.parse(s.startTime)) {
      deps.store.put(emptyRecord(s, "missed"));
      out.missed.push(s.matchId);
      continue;
    }
    const entries: BatchEntry[] = picks.flatMap((p) => [
      { player: p.player, market: "winner" as const, choice: p.winner },
      ...(s.bestOf > 1 && p.score ? [{ player: p.player, market: "score" as const, choice: p.score }] : []),
    ]);
    const batch = canonicalBatch(s.matchId, entries);
    const hash = batchHash(batch);
    const commitDigest = await deps.commit(s.matchId, hash, entries.length);
    deps.store.put({ ...emptyRecord(s, "committed"), picks, batch, batchHash: hash, commitDigest });
    deps.log(`${s.matchId} ${s.teamA} vs ${s.teamB}: committed ${entries.length} picks (${commitDigest})`);
    out.committed.push(s.matchId);
  }
  return out;
}

export function historyLines(store: Store): string[] {
  return store
    .all()
    .filter((r) => r.status === "settled" && r.result)
    .sort((x, y) => x.series.startTime.localeCompare(y.series.startTime))
    .map((r) => `${r.series.startTime.slice(0, 10)} ${r.series.teamA} vs ${r.series.teamB}: ${r.result!.winner} won ${r.result!.score}`);
}

export async function realPickDeps(store = new Store()): Promise<PickDeps> {
  const { fetchSeries } = await import("../core/worlds.ts");
  const { memory } = await import("../core/memory.ts");
  const { askAnalyst } = await import("../core/llm.ts");
  const { commitBatch } = await import("../core/ledger.ts");
  return {
    fetchSeries,
    store,
    recall: async (role, query) => {
      const ns = `kdace-analyst-${role}`;
      const res = await memory(ns).recall({ query, limit: 8, namespace: ns });
      // Lessons without a timestamp can't be proven to predate a pick, so they are not offered.
      return res.results.flatMap((r) => (r.created_at ? [{ blobId: r.blob_id, text: r.text, createdAt: r.created_at }] : []));
    },
    ask: async (prompt) => askAnalyst(prompt),
    commit: commitBatch,
    history: () => historyLines(store),
    now: () => new Date(),
    log: (msg) => console.log(`[pick] ${msg}`),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await runPick(await realPickDeps());
  console.log(`[pick] committed ${result.committed.length}, missed ${result.missed.length}`);
  process.exit(0);
}
