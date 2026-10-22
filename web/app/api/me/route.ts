// GET /api/me → the signed-in fan's address, display name (SuiNS or short address), picks with stakes and AXP
// ({ start, settled, open, available }); 401 when signed out.
import type { NextRequest } from "next/server";
import { getMe } from "../../../../src/core/fanapi.ts";
import { guarded, currentFan, fanDeps, notConfigured, respond } from "../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guarded(async (req: NextRequest) => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  return respond(await getMe(deps, currentFan(deps, req)));
});
