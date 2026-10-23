// Tick dispatcher, run every minute by the lock route when GITHUB_DISPATCH_TOKEN is set: triggers the tick workflow
// early when a committed series' result is in, or a series' final call is due soon, instead of waiting for the next
// 30-minute tick. At most once per 4 minutes (stored in Supabase), never while a tick is queued or running, and never
// when there's nothing to do. Dependency-free (uses fetch).
import { chainOf, sameChain, type Chain } from "./chain.ts";
import type { FanDb } from "./fandb.ts";
import { FINAL_CALL_MARGIN_MS } from "./finalcall.ts";
import { officialResult } from "./results.ts";
import { awaitingResult, LOCK_MARGIN_MS } from "./select.ts";
import type { SeriesRecord } from "./store.ts";
import type { Series } from "./worlds.ts";

/** A record awaiting its result, as the tick publishes it in data/pending.json for the dispatcher. */
export type PendingRecord = { matchId: string; startTime: string; finalCallOpen: boolean };

export const DISPATCH_DEBOUNCE_MS = 4 * 60_000;
/** A final call is chased from this long before lock. */
export const FINAL_CALL_LEAD_MS = 20 * 60_000;
/** A finished series is chased for this long after its start; past that, a settle that keeps failing waits for the regular ticks. */
export const SETTLE_CHASE_MS = 12 * 3600_000;

const REPO = "nikola0x0/kdace";
const WORKFLOW = "tick.yml";

/** Records awaiting a result on the tick's network (others can't be settled by it), each flagged when it's still owed a final call. */
export function pendingRecords(records: SeriesRecord[], chain: Chain): PendingRecord[] {
  return records
    .filter((r) => awaitingResult(r) && (!!r.result || sameChain(chainOf(r), chain)))
    .map((r) => ({ matchId: r.series.matchId, startTime: r.series.startTime, finalCallOpen: r.status === "committed" && !r.finalCall && r.picks.length > 0 }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.matchId.localeCompare(b.matchId));
}

/**
 * Whether to dispatch the tick now, and why. Reasons: a pending series whose official result is in (within 12 h of its
 * start), or a pending series owed a final call that is within 20 minutes of its lock and still 3 minutes before it
 * (by the stored start, or the official one if it moved earlier). `schedule` is null when lolesports couldn't be read.
 */
export function decideDispatch(input: { pending: PendingRecord[]; schedule: Series[] | null; now: Date; lastDispatchAt: string | null; tickActive: boolean }): { dispatch: boolean; reasons: string[] } {
  const { pending, schedule, now, lastDispatchAt, tickActive } = input;
  const t = now.getTime();
  const byId = new Map((schedule ?? []).map((s) => [s.matchId, s]));
  const reasons: string[] = [];
  for (const p of pending) {
    const official = byId.get(p.matchId);
    const start = Math.min(Date.parse(p.startTime), official ? Date.parse(official.startTime) : Infinity);
    if (official?.state === "completed" && officialResult(official) && t - start < SETTLE_CHASE_MS) reasons.push(`${p.matchId}: result is in`);
    const lock = start - LOCK_MARGIN_MS;
    if (p.finalCallOpen && (!official || official.state === "unstarted") && t >= lock - FINAL_CALL_LEAD_MS && t < lock - FINAL_CALL_MARGIN_MS) reasons.push(`${p.matchId}: final call due`);
  }
  if (!reasons.length) return { dispatch: false, reasons };
  if (lastDispatchAt && t - Date.parse(lastDispatchAt) < DISPATCH_DEBOUNCE_MS) return { dispatch: false, reasons };
  if (tickActive) return { dispatch: false, reasons };
  return { dispatch: true, reasons };
}

export type DispatchDeps = {
  db: FanDb;
  /** The published pending records (data/pending.json on main). */
  loadPending(): Promise<PendingRecord[]>;
  fetchSeries(): Promise<Series[]>;
  /** True when a tick run is queued or in progress. */
  tickActive(): Promise<boolean>;
  /** Dispatches the tick workflow. */
  trigger(): Promise<void>;
  now(): Date;
  log(msg: string): void;
};

/** One dispatcher run: decide, check no tick is running, claim the 4-minute slot in Supabase, then dispatch. */
export async function runDispatch(deps: DispatchDeps): Promise<{ dispatched: boolean; reasons: string[] }> {
  const now = deps.now();
  const pending = await deps.loadPending();
  if (!pending.length) return { dispatched: false, reasons: [] };
  const schedule = await deps.fetchSeries().catch((e) => (deps.log(`schedule unavailable: ${(e as Error).message}`), null));
  const base = { pending, schedule, now, lastDispatchAt: await deps.db.lastDispatchAt() };
  const first = decideDispatch({ ...base, tickActive: false });
  if (!first.dispatch) return { dispatched: false, reasons: first.reasons };
  if (await deps.tickActive()) {
    deps.log(`tick already queued or running (${first.reasons.join("; ")})`);
    return { dispatched: false, reasons: first.reasons };
  }
  if (!(await deps.db.claimDispatch(now.toISOString(), new Date(now.getTime() - DISPATCH_DEBOUNCE_MS).toISOString()))) return { dispatched: false, reasons: first.reasons };
  await deps.trigger();
  deps.log(`tick dispatched: ${first.reasons.join("; ")}`);
  return { dispatched: true, reasons: first.reasons };
}

/** The GitHub side of the dispatcher, over the REST API with a token that can read contents and dispatch workflows. */
export function githubDispatcher(token: string, fetchImpl: typeof fetch = fetch): Pick<DispatchDeps, "loadPending" | "tickActive" | "trigger"> {
  const api = (path: string, init: RequestInit = {}, accept = "application/vnd.github+json") =>
    fetchImpl(`https://api.github.com/repos/${REPO}/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" }, cache: "no-store" });
  const runs = async (status: string) => {
    const res = await api(`actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=1`);
    if (!res.ok) throw new Error(`GitHub runs HTTP ${res.status}`);
    return ((await res.json()) as { total_count: number }).total_count;
  };
  return {
    loadPending: async () => {
      const res = await api("contents/data/pending.json?ref=main", {}, "application/vnd.github.raw+json");
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`GitHub pending.json HTTP ${res.status}`);
      return (await res.json()) as PendingRecord[];
    },
    tickActive: async () => (await runs("queued")) > 0 || (await runs("in_progress")) > 0,
    trigger: async () => {
      const res = await api(`actions/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
      if (res.status !== 204 && !res.ok) throw new Error(`GitHub dispatch HTTP ${res.status}: ${await res.text()}`);
    },
  };
}
