// GET /api/picks → open series with the crowd split and AXP pools (and your picks and stakes when signed in).
// POST /api/picks { matchId, market: "winner" | "score", choice, stake } → saves your pick and AXP stake (whole number, at
// least 10, within your available AXP) until lock (start − 5 min, server time)
// and returns a receipt. The last pick before lock counts.
import type { NextRequest } from "next/server";
import { listPicks, postPick } from "../../../../src/core/fanapi.ts";
import { guarded, currentFan, fanDeps, notConfigured, readJson, respond } from "../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guarded(async (req: NextRequest) => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  return respond(await listPicks(deps, currentFan(deps, req)));
});

export const POST = guarded(async (req: NextRequest) => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  return respond(await postPick(deps, currentFan(deps, req), await readJson(req)));
});
