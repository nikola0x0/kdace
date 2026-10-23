// POST /api/claim { matchId } → claims a settled win: its payout (stake + winnings) joins your balance. Once per match.
import type { NextRequest } from "next/server";
import { claimWinnings } from "../../../../src/core/fanapi.ts";
import { guarded, currentFan, fanDeps, notConfigured, readJson, respond } from "../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = guarded(async (req: NextRequest) => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  return respond(await claimWinnings(deps, currentFan(deps, req), await readJson(req)));
});
