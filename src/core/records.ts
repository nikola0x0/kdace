// The public records endpoint (/api/records) as a read-only store, so `npm run verify` can check the live records
// (KDACE_RECORDS_URL) exactly as it checks data/ in git. Dependency-free (uses fetch).
import { MemoryStore, type RecordsSnapshot } from "./store.ts";

/** Fetches every series record, the board and every title day from `url` into a MemoryStore. Throws on a bad answer. */
export async function recordsFromUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<MemoryStore> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Records endpoint ${url} answered HTTP ${res.status}`);
  const body = (await res.json()) as Partial<RecordsSnapshot>;
  if (!Array.isArray(body.series) || !Array.isArray(body.board) || !Array.isArray(body.titleDays)) throw new Error(`Records endpoint ${url} did not return series, board and titleDays`);
  return MemoryStore.from({ series: body.series, board: body.board, titleDays: body.titleDays, fanNames: {} });
}
