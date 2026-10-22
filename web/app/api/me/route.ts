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
  const fan = currentFan(deps, req);
  // Signed out is a normal state, not an error: answer 200 with null so browsers don't log a failed request.
  if (!fan) return respond({ status: 200, body: null });
  return respond(await getMe(deps, fan));
});
