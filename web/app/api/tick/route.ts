// POST /api/tick (Authorization: Bearer $LOCK_SECRET), called every minute by Supabase pg_cron + pg_net once the
// kdace-tick job is enabled (supabase/migrations/20261024000100_tick_cron.sql): one call of the staged runner
// (src/jobs/runner.ts). Under the runner lock it runs the settle stage if due, then at most one heavy stage (final
// call, pick, Scout, title calls, banter, lessons), and returns what it did. Nothing due → a few reads and out.
// Off unless KDACE_STORE=supabase: with the file store the records live in git, and this route refuses to run.
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { storeKind } from "../../../../src/core/supastore.ts";
import { DEFAULT_BUDGET_MS, realRunnerDeps, runOnce } from "../../../../src/jobs/runner.ts";
import { guarded, lockAuthorized } from "../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = guarded(async (req: NextRequest) => {
  if (!lockAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let kind: "file" | "supabase";
  try {
    kind = storeKind();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (kind !== "supabase") return NextResponse.json({ error: "runner is off: KDACE_STORE is not supabase" }, { status: 409 });
  const holder = `vercel:${randomUUID()}`;
  try {
    const report = await runOnce(await realRunnerDeps({ budgetMs: DEFAULT_BUDGET_MS }), holder);
    return NextResponse.json(report, { status: report.busy ? 202 : 200 });
  } catch (e) {
    // Supabase unreachable (or the store unreadable): nothing was written; the next minute tries again.
    console.error(`[tick] ${(e as Error).message}`);
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
});
