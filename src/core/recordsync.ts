// Copies and compares the published records between two stores: data/ → Supabase at cutover
// (scripts/migrate-to-supabase.ts), and Supabase → data/ for the daily snapshot (scripts/export-records.ts).
// Idempotent: only what differs is written, nothing is ever deleted (rows only in the target are reported), and record
// content is copied as-is (never re-derived), so every chain stamp and batch string stays byte-for-byte the same.
import { SCOUT_KEYS, type RecordStore } from "./store.ts";
import { canonicalJson } from "./supastore.ts";

type Counts = { inserted: number; updated: number; same: number; extra: string[] };
export type CopyReport = { series: Counts; titleDays: Counts; docs: { written: string[]; same: string[] }; scout: { written: string[]; same: string[] } };

/** Copies every series record, title day, the board, fan names and Scout from `from` into `to`. `dryRun` only counts. */
export async function copyRecords(from: RecordStore, to: RecordStore, opts: { dryRun?: boolean } = {}): Promise<CopyReport> {
  const write = !opts.dryRun;
  const series: Counts = { inserted: 0, updated: 0, same: 0, extra: [] };
  const src = await from.all();
  for (const r of src) {
    const existing = await to.get(r.series.matchId); // read first: the Supabase store only overwrites the version it read
    if (existing && canonicalJson(existing) === canonicalJson(r)) series.same++;
    else {
      existing ? series.updated++ : series.inserted++;
      if (write) await to.put(r);
    }
  }
  const srcIds = new Set(src.map((r) => r.series.matchId));
  series.extra = (await to.all()).map((r) => r.series.matchId).filter((id) => !srcIds.has(id)).sort();

  const titleDays: Counts = { inserted: 0, updated: 0, same: 0, extra: [] };
  const days = await from.titleDays();
  for (const d of days) {
    const existing = await to.getTitleDay(d.date);
    if (existing && canonicalJson(existing) === canonicalJson(d)) titleDays.same++;
    else {
      existing ? titleDays.updated++ : titleDays.inserted++;
      if (write) await to.putTitleDay(d);
    }
  }
  const dates = new Set(days.map((d) => d.date));
  titleDays.extra = (await to.titleDays()).map((d) => d.date).filter((d) => !dates.has(d));

  const docs = { written: [] as string[], same: [] as string[] };
  const board = await from.readBoard();
  if (canonicalJson(board) === canonicalJson(await to.readBoard())) docs.same.push("board");
  else (docs.written.push("board"), write && (await to.writeBoard(board)));
  const names = await from.readFanNames();
  if (canonicalJson(names) === canonicalJson(await to.readFanNames())) docs.same.push("fan_names");
  else (docs.written.push("fan_names"), write && (await to.writeFanNames(names)));

  const scout = { written: [] as string[], same: [] as string[] };
  for (const key of SCOUT_KEYS) {
    const value = await from.readScoutFile(key);
    if (value === null) continue;
    if (canonicalJson(value) === canonicalJson(await to.readScoutFile(key))) scout.same.push(key);
    else (scout.written.push(key), write && (await to.writeScout({ [key]: value })));
  }
  return { series, titleDays, docs, scout };
}

export type CompareReport = { identical: boolean; byteExact: boolean; differences: string[] };

/**
 * Diffs `b` against `a`: series records, title days, board, fan names and Scout. `identical` means the same content
 * everywhere; `byteExact` also means the same key order (the JSON files an export writes would be byte-identical).
 */
export async function compareRecords(a: RecordStore, b: RecordStore): Promise<CompareReport> {
  const differences: string[] = [];
  let byteExact = true;
  const diff = (label: string, x: unknown, y: unknown) => {
    if (x === null || x === undefined) {
      if (y !== null && y !== undefined) differences.push(`${label}: only in target`);
      return;
    }
    if (y === null || y === undefined) return void differences.push(`${label}: missing in target`);
    if (canonicalJson(x) !== canonicalJson(y)) return void differences.push(`${label}: content differs`);
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      byteExact = false;
      differences.push(`${label}: same content, different key order`);
    }
  };
  const [as, bs] = [await a.all(), await b.all()];
  const ids = [...new Set([...as, ...bs].map((r) => r.series.matchId))].sort();
  for (const id of ids) diff(`series ${id}`, as.find((r) => r.series.matchId === id), bs.find((r) => r.series.matchId === id));
  const [ad, bd] = [await a.titleDays(), await b.titleDays()];
  for (const date of [...new Set([...ad, ...bd].map((d) => d.date))].sort()) diff(`title day ${date}`, ad.find((d) => d.date === date), bd.find((d) => d.date === date));
  diff("board", await a.readBoard(), await b.readBoard());
  diff("fan names", await a.readFanNames(), await b.readFanNames());
  for (const key of SCOUT_KEYS) diff(`scout ${key}`, await a.readScoutFile(key), await b.readScoutFile(key));
  const identical = differences.every((d) => d.endsWith("different key order"));
  return { identical, byteExact, differences };
}
