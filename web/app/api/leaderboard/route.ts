// GET /api/leaderboard → every signed-in fan with balance (10,000 + settled), net and AXP in open positions.
import { leaderboardFans } from "../../../../src/core/fanapi.ts";
import { guarded, fanDeps, notConfigured, respond } from "../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guarded(async () => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  return respond(await leaderboardFans(deps));
});
