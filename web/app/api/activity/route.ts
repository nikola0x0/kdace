// GET /api/activity[?matchId=…] → the latest buys for the live feed (public: picks are published anyway).
import type { NextRequest } from "next/server";
import { activity } from "../../../../src/core/fanapi.ts";
import { guarded, fanDeps, notConfigured, respond } from "../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guarded(async (req: NextRequest) => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  return respond(await activity(deps, { matchId: req.nextUrl.searchParams.get("matchId") ?? undefined }));
});
