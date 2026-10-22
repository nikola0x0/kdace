// POST /api/lock (Authorization: Bearer $LOCK_SECRET), called every minute by Supabase pg_cron + pg_net:
// commits each just-locked series' fan batch on Sui under `<matchId>:fans` and records it in fan_commits.
import { NextResponse, type NextRequest } from "next/server";
import { commitBatch, currentChain } from "../../../../src/core/ledger.ts";
import { fanDbFromEnv } from "../../../../src/core/fandb.ts";
import { runFanLock } from "../../../../src/core/fanlock.ts";
import { fetchSeries } from "../../../../src/core/worlds.ts";
import { guarded, lockAuthorized } from "../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = guarded(async (req: NextRequest) => {
  if (!lockAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = fanDbFromEnv();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const log: string[] = [];
  const result = await runFanLock({
    db,
    fetchSeries, // always fresh here: the lock decision uses the official schedule as of now
    commit: commitBatch,
    chain: currentChain(),
    now: () => new Date(),
    log: (msg) => (log.push(msg), console.log(`[fan-lock] ${msg}`)),
  });
  return NextResponse.json({ ...result, log });
});

export const GET = POST;
