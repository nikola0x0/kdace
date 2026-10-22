// GET /api/auth/nonce?address=0x… → the sign-in message to sign and the network to sign it on; sets a short-lived nonce cookie.
import type { NextRequest } from "next/server";
import { issueNonce } from "../../../../../src/core/fanapi.ts";
import { guarded, fanDeps, notConfigured, respond } from "../../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = guarded(async (req: NextRequest) => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  return respond(await issueNonce(deps, req.nextUrl.searchParams.get("address")));
});
