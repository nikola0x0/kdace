// POST /api/auth/verify { bytes, signature } (base64, as the wallet returns them) → verifies the signed sign-in message
// (zkLogin included) and sets the httpOnly session cookie.
import type { NextRequest } from "next/server";
import { signIn } from "../../../../../src/core/fanapi.ts";
import { guarded, fanDeps, NONCE_COOKIE, notConfigured, readJson, respond } from "../../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = guarded(async (req: NextRequest) => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  return respond(await signIn(deps, { bytes: body.bytes, signature: body.signature, nonceToken: req.cookies.get(NONCE_COOKIE)?.value }));
});
