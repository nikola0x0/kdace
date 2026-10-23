// Final-call stage (tick): once per series, close to lock, every analyst may top up the side it picked. The calls and
// the top-up batch are recorded before the chain call, so a crash resumes with the same hash (never re-asks), and a
// series never gets a second final call. Nobody adding is recorded as "none" with no chain call.
import { ANALYSTS, MIN_STAKE } from "../core/analysts.ts";
import { batchHash, canonicalBatch } from "../core/batch.ts";
import { chainOf, sameChain, type Chain } from "../core/chain.ts";
import { buildFinalCallPrompt, effectiveStart, finalCallDue, finalCallEntries, finalMarketId, parseFinalCall, winnerPools, type FinalCallEntry } from "../core/finalcall.ts";
import type { AnalystReply } from "../core/llm.ts";
import { LOCK_MARGIN_MS } from "../core/select.ts";
import { axpAccount, type FinalCall, type RecordStore, type SeriesRecord } from "../core/store.ts";
import type { Series } from "../core/worlds.ts";

export type FinalCallDeps = {
  fetchSeries(): Promise<Series[]>;
  store: RecordStore;
  ask(prompt: string): Promise<string | AnalystReply>;
  commit(marketId: string, hash: string, count: number): Promise<string>;
  /** Where commit() writes; stamped on the final call. */
  chain: Chain;
  /** The fans' winner pool per team from Supabase (throws or null when unavailable: the analysts-only pool is shown). */
  fanPool(matchId: string): Promise<Record<string, number> | null>;
  history(): string[];
  now(): Date;
  log(msg: string): void;
};

const lockedAt = (start: number, now: Date) => now.getTime() >= start - LOCK_MARGIN_MS;

/** Commits a recorded final call; the record already holds the hash, so a retry re-submits the identical fingerprint. */
async function commitFinal(deps: FinalCallDeps, matchId: string, f: FinalCall): Promise<void> {
  const count = (JSON.parse(f.batch!) as { entries: unknown[] }).entries.length;
  const commitDigest = await deps.commit(finalMarketId(matchId), f.batchHash!, count);
  await deps.store.put({ ...(await deps.store.get(matchId))!, finalCall: { ...f, status: "committed", commitDigest, chain: deps.chain } });
  deps.log(`${matchId}: final call committed, ${count} top-up${count > 1 ? "s" : ""} (${commitDigest})`);
}

const setFinal = async (deps: FinalCallDeps, matchId: string, finalCall: FinalCall) => deps.store.put({ ...(await deps.store.get(matchId))!, finalCall });

async function askAll(deps: FinalCallDeps, r: SeriesRecord, s: Series): Promise<FinalCallEntry[]> {
  let fans: Record<string, number> | null = null;
  try {
    fans = await deps.fanPool(r.series.matchId);
  } catch (e) {
    deps.log(`${r.series.matchId} fans' pool unavailable, analysts only: ${(e as Error).message}`);
  }
  const pools = winnerPools(r, fans);
  const records = await deps.store.all();
  const history = deps.history();
  // In parallel: the whole final call has to land before lock.
  const calls = await Promise.all(
    r.picks.map(async (pick): Promise<FinalCallEntry | null> => {
      const a = ANALYSTS.find((x) => x.player === pick.player);
      if (!a) return null;
      const { available } = axpAccount(records, a.player);
      if (available < MIN_STAKE) return null; // nothing it could add
      const prompt = buildFinalCallPrompt(a, s, pick, available, pools, history);
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const reply = await deps.ask(prompt);
          const { add, reasoning } = parseFinalCall(typeof reply === "string" ? reply : reply.text, available);
          return { player: a.player, add, reasoning, decidedAt: deps.now().toISOString() };
        } catch (e) {
          deps.log(`${r.series.matchId} ${a.player} final call attempt ${attempt} invalid: ${(e as Error).message}`);
        }
      }
      return null;
    }),
  );
  return calls.filter((c): c is FinalCallEntry => c !== null);
}

/** Options for one run. The default is the tick's (every due series); the Vercel runner asks for one series per run. */
export type FinalCallOptions = { /** At most this many new final calls per run (soonest first); interrupted commits always resume. */ maxNew?: number };

export async function runFinalCall(deps: FinalCallDeps, opts: FinalCallOptions = {}): Promise<{ committed: string[]; none: string[]; missed: string[] }> {
  const { maxNew = Infinity } = opts;
  let started = 0;
  const out = { committed: [] as string[], none: [] as string[], missed: [] as string[] };
  const now = deps.now();

  // Interrupted commits: re-submit the same hash while before lock, or give up honestly (the top-ups never count).
  for (const r of (await deps.store.all()).filter((x) => x.finalCall?.status === "committing")) {
    const id = r.series.matchId;
    if (lockedAt(Date.parse(r.series.startTime), now) || r.status !== "committed") {
      await setFinal(deps, id, { ...r.finalCall!, status: "missed" });
      out.missed.push(id);
      continue;
    }
    try {
      await commitFinal(deps, id, r.finalCall!);
      out.committed.push(id);
    } catch (e) {
      deps.log(`${id} final call resume failed, will retry before lock: ${(e as Error).message}`);
    }
  }

  let schedule: Series[];
  try {
    schedule = await deps.fetchSeries();
  } catch (e) {
    deps.log(`schedule unavailable, no new final calls this run: ${(e as Error).message}`);
    return out;
  }
  const records = await deps.store.all();
  for (const r of records.sort((a, b) => a.series.startTime.localeCompare(b.series.startTime))) {
    const id = r.series.matchId;
    if (!finalCallDue(r, schedule, await deps.store.all(), now).due) continue;
    if (!sameChain(chainOf(r), deps.chain)) continue; // a final call goes where its series was committed
    const official = schedule.find((s) => s.matchId === id);
    const start = effectiveStart(r, official);
    if (started++ >= maxNew) break;
    try {
      const calls = await askAll(deps, r, r.series);
      const entries = finalCallEntries(r.picks, calls);
      if (lockedAt(start, deps.now())) {
        await setFinal(deps, id, { status: "missed", batch: null, batchHash: null, commitDigest: null, calls });
        deps.log(`${id}: lock passed during the final call; nothing committed`);
        out.missed.push(id);
        continue;
      }
      if (!entries.length) {
        await setFinal(deps, id, { status: "none", batch: null, batchHash: null, commitDigest: null, calls });
        deps.log(`${id}: final call, nobody added`);
        out.none.push(id);
        continue;
      }
      const batch = canonicalBatch(finalMarketId(id), entries);
      const f: FinalCall = { status: "committing", batch, batchHash: batchHash(batch), commitDigest: null, calls };
      await setFinal(deps, id, f); // recorded before the chain call: a crash resumes with this hash, never a second final call
      await commitFinal(deps, id, f);
      out.committed.push(id);
    } catch (e) {
      deps.log(`${id} final call failed: ${(e as Error).message}`);
    }
  }
  return out;
}

export async function realFinalCallDeps(store: RecordStore): Promise<FinalCallDeps> {
  const { fetchSeries } = await import("../core/worlds.ts");
  const { askAnalystFull } = await import("../core/llm.ts");
  const { commitBatch, currentChain } = await import("../core/ledger.ts");
  const { fanDbFromEnv, withRefereeLock } = await import("../core/fandb.ts");
  const { crowdSplit } = await import("../core/fans.ts");
  const { historyLines } = await import("./pick.ts");
  const db = fanDbFromEnv();
  const history = historyLines(await store.all());
  return {
    fetchSeries,
    store,
    // High effort (not xhigh): a smaller, time-critical decision.
    ask: (prompt) => askAnalystFull(prompt, "high"),
    commit: (marketId, hash, count) => withRefereeLock(db, "tick", () => commitBatch(marketId, hash, count), { waitMs: 2 * 60_000, proceedIfDbDown: true }),
    chain: currentChain(),
    fanPool: async (matchId) => {
      const r = await store.get(matchId);
      if (!db || !r) return null;
      return crowdSplit(r.series, await db.picksFor([matchId])).winnerPool;
    },
    history: () => history,
    now: () => new Date(),
    log: (msg) => console.log(`[final] ${msg}`),
  };
}
