// POST /api/lock (Authorization: Bearer $LOCK_SECRET), called every minute by Supabase pg_cron + pg_net:
// commits each just-locked series' fan batch on Sui under `<matchId>:fans` and records it in fan_commits.
// With GITHUB_DISPATCH_TOKEN set, it also dispatches the tick workflow early when a result is in or a final call is due
// (src/core/dispatch.ts); a dispatcher failure never affects the fan lock.
import { NextResponse, type NextRequest } from "next/server";
import { commitBatch, currentChain } from "../../../../src/core/ledger.ts";
import { githubDispatcher, runDispatch } from "../../../../src/core/dispatch.ts";
import { fanDbFromEnv } from "../../../../src/core/fandb.ts";
import { runFanLock } from "../../../../src/core/fanlock.ts";
import { fetchSeries, type Series } from "../../../../src/core/worlds.ts";
import { guarded, lockAuthorized } from "../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = guarded(async (req: NextRequest) => {
  if (!lockAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = fanDbFromEnv();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const log: string[] = [];
  const say = (prefix: string) => (msg: string) => (log.push(msg), console.log(`[${prefix}] ${msg}`));
  // One schedule read per run, shared by the lock and the dispatcher (always fresh: the lock is judged on it as of now).
  let schedule: Promise<Series[]> | undefined;
  const series = () => (schedule ??= fetchSeries());
  let result: Awaited<ReturnType<typeof runFanLock>> | { error: string };
  try {
    result = await runFanLock({ db, fetchSeries: series, commit: commitBatch, chain: currentChain(), now: () => new Date(), log: say("fan-lock") });
  } catch (e) {
    result = { error: (e as Error).message };
  }
  let dispatch: Awaited<ReturnType<typeof runDispatch>> | { error: string } | null = null;
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (token) {
    try {
      dispatch = await runDispatch({ db, fetchSeries: series, ...githubDispatcher(token), now: () => new Date(), log: say("dispatch") });
    } catch (e) {
      dispatch = { error: (e as Error).message };
      console.log(`[dispatch] failed: ${dispatch.error}`);
    }
  }
  if ("error" in result) return NextResponse.json({ error: result.error, dispatch, log }, { status: 500 });
  return NextResponse.json({ ...result, dispatch, log });
});

export const GET = POST;
