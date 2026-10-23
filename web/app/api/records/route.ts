// GET /api/records → every published series record, the board and every title day, as JSON (public, read-only).
// The same data the repo's data/ directory holds (batches, digests, picks, debates, lessons; fan entries appear only as
// the fan:<address> entries already in the committed batches). No fan names, no secrets. `npm run verify` can check
// it directly: KDACE_RECORDS_URL=https://kdace.xyz/api/records npm run verify.
// Supabase mode: served from the site's 20-second snapshot, cached at the edge for 30 s.
import { NextResponse } from "next/server";
import { loadRecords, store } from "../../../lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await loadRecords({ page: false });
    const s = store();
    const series = s.all().sort((a, b) => a.series.startTime.localeCompare(b.series.startTime) || a.series.matchId.localeCompare(b.series.matchId));
    return NextResponse.json(
      { generatedAt: new Date().toISOString(), series, board: s.readBoard(), titleDays: s.titleDays() },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60", "Access-Control-Allow-Origin": "*" } },
    );
  } catch (e) {
    console.error(`[records] ${(e as Error).message}`);
    return NextResponse.json({ error: "Records are unavailable right now; the repository's data/ directory has the daily snapshot." }, { status: 503 });
  }
}
