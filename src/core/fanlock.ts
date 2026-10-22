// Fan lock job, run every minute by the lock route: for each series whose lock just passed, bundle the final fan
// picks into one batch and commit its fingerprint on Sui before the game starts. Dependency-free (deps injected).
import { batchHash, canonicalBatch } from "./batch.ts";
import type { Chain } from "./chain.ts";
import { withRefereeLock, type FanCommitRow, type FanDb } from "./fandb.ts";
import { fanEntries, fanMarketId, lockAt } from "./fans.ts";
import type { Series } from "./worlds.ts";

export type FanLockDeps = {
  db: FanDb;
  fetchSeries(): Promise<Series[]>;
  commit(marketId: string, hash: string, count: number): Promise<string>;
  /** Where commit() writes; stored on each fan commit. */
  chain: Chain;
  now(): Date;
  log(msg: string): void;
};

/** A pick accepted a moment before lock may still be in flight; wait this long after lock before reading picks. */
export const LOCK_GRACE_MS = 20_000;
/** A `committing` row this old belongs to a run that crashed or timed out, and may be resumed. */
export const STALE_COMMIT_MS = 90_000;
/** Series that locked longer ago than this are left alone (keeps each run's queries small). */
export const LOOKBACK_MS = 6 * 3600_000;

const started = (s: Series, now: Date) => s.state !== "unstarted" || now.getTime() >= Date.parse(s.startTime);

export async function runFanLock(deps: FanLockDeps): Promise<{ committed: string[]; missed: string[] }> {
  const out = { committed: [] as string[], missed: [] as string[] };
  const now = deps.now();
  const byId = new Map((await deps.fetchSeries()).map((s) => [s.matchId, s]));
  const existing = new Map((await deps.db.listCommits()).map((c) => [c.matchId, c]));

  /** The row already holds the batch and hash, so a retry re-submits the identical fingerprint. */
  const commitRow = async (row: FanCommitRow) => {
    try {
      const digest = await withRefereeLock(deps.db, "fan-lock", () => deps.commit(fanMarketId(row.matchId), row.batchHash!, row.pickCount), { waitMs: 40_000 });
      await deps.db.updateCommit(row.matchId, { status: "committed", commitDigest: digest, committedAt: deps.now().toISOString() });
      deps.log(`${row.matchId}: committed ${row.pickCount} fan picks (${digest})`);
      out.committed.push(row.matchId);
    } catch (e) {
      deps.log(`${row.matchId}: fan commit failed, will retry while before start: ${(e as Error).message}`);
    }
  };

  // Interrupted commits: resume once stale and still before the game, or give up honestly.
  for (const c of existing.values()) {
    if (c.status !== "committing") continue;
    const s = byId.get(c.matchId);
    if (!s || started(s, now)) {
      if (await deps.db.updateCommit(c.matchId, { status: "missed" }, c.attemptedAt)) out.missed.push(c.matchId);
    } else if (now.getTime() - Date.parse(c.attemptedAt) >= STALE_COMMIT_MS) {
      const attemptedAt = now.toISOString();
      if (await deps.db.updateCommit(c.matchId, { attemptedAt }, c.attemptedAt)) await commitRow({ ...c, attemptedAt });
    }
  }

  const due = [...byId.values()].filter(
    (s) =>
      s.teamA !== "TBD" && s.teamB !== "TBD" && !existing.has(s.matchId) &&
      now.getTime() >= Date.parse(lockAt(s.startTime)) + LOCK_GRACE_MS &&
      now.getTime() - Date.parse(s.startTime) < LOOKBACK_MS,
  );
  const picks = await deps.db.picksFor(due.map((s) => s.matchId));
  for (const s of due) {
    const entries = fanEntries(s, picks);
    if (!entries.length) continue;
    const batch = canonicalBatch(fanMarketId(s.matchId), entries);
    const row: FanCommitRow = {
      matchId: s.matchId, status: started(s, now) ? "missed" : "committing", batch, batchHash: batchHash(batch), pickCount: entries.length,
      commitDigest: null, network: deps.chain.network, packageId: deps.chain.packageId, committedAt: null, attemptedAt: now.toISOString(),
    };
    // Recorded before the chain call; the unique match_id makes the insert the claim, so overlapping runs can't both commit.
    if (!(await deps.db.insertCommit(row))) continue;
    if (row.status === "missed") {
      deps.log(`${s.matchId}: game already started, fan batch recorded as missed`);
      out.missed.push(s.matchId);
      continue;
    }
    await commitRow(row);
  }
  return out;
}
