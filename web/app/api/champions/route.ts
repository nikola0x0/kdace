// GET /api/champions → { version, champions: [{ id, name }] } from Data Dragon, for the favourite-champion picker and icons.
import { NextResponse } from "next/server";
import { championList } from "../../../lib/champions";

export const revalidate = 86400;

export async function GET() {
  const list = await championList();
  return list ? NextResponse.json(list, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }) : NextResponse.json({ error: "Champion list unavailable" }, { status: 503 });
}
