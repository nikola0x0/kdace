// POST /api/auth/logout → clears the session cookie.
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "../../../../lib/server/fans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
