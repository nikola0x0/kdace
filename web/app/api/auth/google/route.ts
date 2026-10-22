// POST /api/auth/google { idToken } (the Google Identity Services credential) → verifies the Google ID token,
// derives the fan's zkLogin address from our salt and sets the httpOnly session cookie. No wallet, no prover.
import type { NextRequest } from "next/server";
import { googleSignIn } from "../../../../../src/core/fanapi.ts";
import { guarded, fanDeps, notConfigured, readJson, respond } from "../../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = guarded(async (req: NextRequest) => {
  const deps = fanDeps();
  if (!deps) return notConfigured();
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  return respond(await googleSignIn(deps, { idToken: body.idToken }));
});
