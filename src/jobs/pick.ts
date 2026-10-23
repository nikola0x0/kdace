// Pick job: every analyst picks each open series blind, and the batch fingerprint is committed before the game.
import { pathToFileURL } from "node:url";
import { withLock } from "../core/lock.ts";
import { analystEntries, analystStakes, ANALYSTS, buildPickPrompt, parsePick, type AnalystPick, type Lesson, type Role } from "../core/analysts.ts";
import { batchHash, canonicalBatch } from "../core/batch.ts";
import type { Chain } from "../core/chain.ts";
import { fanDbFromEnv, withRefereeLock } from "../core/fandb.ts";
import { isLocked, seriesToPick, seriesToResume } from "../core/select.ts";
import { axpAccount, Store, type SeriesRecord } from "../core/store.ts";
import type { AnalystReply } from "../core/llm.ts";
import type { Series } from "../core/worlds.ts";

export type PickDeps = {
  fetchSeries(): Promise<Series[]>;
  store: Store;
  recall(role: Role, query: string): Promise<Lesson[]>;
  /** The analyst's reply; with thinking on, also its thinking summary. */
  ask(prompt: string): Promise<string | AnalystReply>;
  commit(matchId: string, hash: string, count: number): Promise<string>;
  /** Where commit() writes; stamped on each committed record. */
  chain: Chain;
  history(): string[];
  /** Scout's 2026 stats digest for a matchup (data/scout), or null when there's none. */
  scout?(teamA: string, teamB: string): string | null;
  now(): Date;
  log(msg: string): void;
};

const MIN_ANALYSTS = 3;

export const emptyRecord = (series: Series, status: SeriesRecord["status"]): SeriesRecord => ({
  series, status, picks: [], batch: null, batchHash: null, commitDigest: null, result: null, axp: null, debate: null, lessons: [],
});

async function analystPicks(deps: PickDeps, s: Series, scout: string | null): Promise<AnalystPick[]> {
  const picks: AnalystPick[] = [];
  const history = deps.history();
  const records = deps.store.all();
  for (const a of ANALYSTS) {
    // Stakes follow from confidence and the AXP this analyst has free now (settled results minus open bets).
    const { available } = axpAccount(records, a.player);
    const lessons = await deps.recall(a.role, `Predicting ${s.teamA} vs ${s.teamB}, a Bo${s.bestOf} at Worlds`).catch((e) => {
      deps.log(`${s.matchId} ${a.player} recall failed, picking without lessons: ${(e as Error).message}`);
      return [] as Lesson[];
    });
    const prompt = buildPickPrompt(a, s, lessons, history, scout);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const reply = await deps.ask(prompt);
        const { text, thinking } = typeof reply === "string" ? { text: reply, thinking: undefined } : reply;
        const pick = parsePick(text, a, s, lessons, deps.now());
        picks.push({ ...pick, ...(thinking !== undefined ? { thinking } : {}), ...analystStakes(pick.winProbability, available, s.bestOf) });
        break;
      } catch (e) {
        deps.log(`${s.matchId} ${a.player} attempt ${attempt} invalid: ${(e as Error).message}`);
      }
    }
  }
  return picks;
}

/** Commits a recorded batch; the record already holds the hash, so a retry re-submits the identical fingerprint. */
async function commitRecord(deps: PickDeps, r: SeriesRecord, out: { committed: string[] }) {
  const count = (JSON.parse(r.batch!) as { entries: unknown[] }).entries.length;
  const commitDigest = await deps.commit(r.series.matchId, r.batchHash!, count);
  deps.store.put({ ...r, status: "committed", commitDigest, chain: deps.chain });
  deps.log(`${r.series.matchId} ${r.series.teamA} vs ${r.series.teamB}: committed ${count} picks (${commitDigest})`);
  out.committed.push(r.series.matchId);
}

export async function runPick(deps: PickDeps): Promise<{ committed: string[]; missed: string[] }> {
  const out = { committed: [] as string[], missed: [] as string[] };

  // Interrupted commits: re-submit the same hash, or give up honestly once the lock has passed.
  for (const r of deps.store.all().filter((x) => x.status === "committing" && isLocked(x.series.startTime, deps.now()))) {
    deps.store.put({ ...r, status: "missed" });
    out.missed.push(r.series.matchId);
  }
  for (const r of seriesToResume(deps.store, deps.now())) {
    try {
      await commitRecord(deps, r, out);
    } catch (e) {
      deps.log(`${r.series.matchId} resume failed, will retry: ${(e as Error).message}`);
    }
  }

  const { pick, missed } = seriesToPick(await deps.fetchSeries(), deps.store, deps.now());
  for (const s of missed) {
    deps.store.put(emptyRecord(s, "missed"));
    out.missed.push(s.matchId);
  }
  for (const s of pick) {
    try {
      const scout = deps.scout?.(s.teamA, s.teamB) ?? null;
      const picks = await analystPicks(deps, s, scout);
      if (picks.length < MIN_ANALYSTS) {
        deps.log(`${s.matchId} only ${picks.length} valid picks; not committing, will retry next run`);
        continue;
      }
      if (isLocked(s.startTime, deps.now())) {
        deps.store.put(emptyRecord(s, "missed"));
        out.missed.push(s.matchId);
        continue;
      }
      const batch = canonicalBatch(s.matchId, analystEntries(s.bestOf, picks));
      const record: SeriesRecord = { ...emptyRecord(s, "committing"), picks, batch, batchHash: batchHash(batch), ...(scout ? { scout } : {}) };
      deps.store.put(record); // recorded before the chain call, so a crash resumes with the same hash instead of re-picking
      await commitRecord(deps, record, out);
    } catch (e) {
      deps.log(`${s.matchId} failed: ${(e as Error).message}`);
    }
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
  const { askAnalystFull } = await import("../core/llm.ts");
  const { loadScout, scoutDigest } = await import("../core/scoutstore.ts");
  const scoutData = loadScout();
  const { commitBatch, currentChain } = await import("../core/ledger.ts");
  return {
    fetchSeries,
    store,
    recall: async (role, query) => {
      const ns = `kdace-analyst-${role}`;
      const res = await memory(ns).recall({ query, limit: 8, namespace: ns });
      // Lessons without a timestamp can't be proven to predate a pick, so they are not offered.
      return res.results.flatMap((r) => (r.created_at ? [{ blobId: r.blob_id, text: r.text, createdAt: r.created_at }] : []));
    },
    // Picks get the deepest thinking: each one is fingerprinted and published with its thinking summary.
    ask: (prompt) => askAnalystFull(prompt, "xhigh"),
    // Shares the Referee with the fan lock route; the Supabase mutex keeps their transactions apart.
    commit: (matchId, hash, count) => withRefereeLock(fanDbFromEnv(), "tick", () => commitBatch(matchId, hash, count), { waitMs: 5 * 60_000, proceedIfDbDown: true }),
    chain: currentChain(),
    history: () => historyLines(store),
    scout: (a, b) => scoutDigest(a, b, scoutData),
    now: () => new Date(),
    log: (msg) => console.log(`[pick] ${msg}`),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await withLock("data", async () => runPick(await realPickDeps()));
  console.log(`[pick] committed ${result.committed.length}, missed ${result.missed.length}`);
  process.exit(0);
}
