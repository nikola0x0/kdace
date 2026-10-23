// POST /api/cancel { buyId } → cancels one of your buys before the match locks; its AXP returns to your balance.
import type { NextRequest } from "next/server";
import { cancelBuy } from "../../../../src/core/fanapi.ts";
import { guarded, currentFan, fanDeps, notConfigured, readJson, respond } from "../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = guarded(async (req: NextRequest) => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  return respond(await cancelBuy(deps, currentFan(deps, req), await readJson(req)));
});
