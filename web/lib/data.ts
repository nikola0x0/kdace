// Reads the backend's published records. By default from ../data (override with KDACE_DATA_DIR), baked in at build.
// With KDACE_STORE=supabase, from Supabase (server-side, service role key): pages that call loadRecords() render per
// request from a snapshot refreshed at most every 20 s, so they update without a redeploy. If Supabase is briefly
// unreachable the last snapshot keeps being served.
import { join } from "node:path";
import { connection } from "next/server";
import { Store, viewOf, type RecordReader, type RecordsSnapshot } from "../../src/core/store.ts";
import { storeKind, SupabaseStore, supabaseRestFromEnv } from "../../src/core/supastore.ts";

const TTL_MS = 20_000;
let snap: { at: number; reader: RecordReader } | null = null;
let loading: Promise<void> | null = null;

/** True when the records come from Supabase (KDACE_STORE=supabase). */
export const supabaseMode = () => storeKind() === "supabase";

/** A read-only view of a snapshot (no copies: pages only read). */
function readerOf(s: RecordsSnapshot): RecordReader {
  const view = viewOf(s.series);
  return { get: view.get, all: () => [...s.series], readBoard: () => s.board, readFanNames: () => s.fanNames, titleDays: () => [...s.titleDays] };
}

/**
 * Call (and await) at the top of every page that reads records. File mode: does nothing, the page stays static. Supabase
 * mode: makes the page dynamic and refreshes the snapshot when it is older than 20 s. Route handlers (already dynamic)
 * pass `{ page: false }`.
 */
export async function loadRecords(opts: { page?: boolean } = {}): Promise<void> {
  if (!supabaseMode()) return;
  if (opts.page !== false) await connection();
  if (snap && Date.now() - snap.at < TTL_MS) return;
  loading ??= (async () => {
    try {
      snap = { at: Date.now(), reader: readerOf(await new SupabaseStore(supabaseRestFromEnv()).snapshot()) };
    } catch (e) {
      if (!snap) throw e;
      console.error(`[records] Supabase unavailable, serving the snapshot from ${new Date(snap.at).toISOString()}: ${(e as Error).message}`);
    } finally {
      loading = null;
    }
  })();
  await loading;
}

/** The records as last loaded. In Supabase mode, loadRecords() must have run first in this request. */
export const store = (): RecordReader => {
  if (!supabaseMode()) return new Store(process.env.KDACE_DATA_DIR ?? join(process.cwd(), "..", "data"));
  if (!snap) throw new Error("Records not loaded: await loadRecords() at the top of the page");
  return snap.reader;
};
