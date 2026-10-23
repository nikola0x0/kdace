// Fan stage of the tick: copy each fan-batch commit from Supabase into the series records (data/series/<matchId>.json
// or the Supabase store), so verify and the site read it like everything else. Runs before settle, so AXP settlement
// includes the fans.
import type { FanCommitRow, FanDb } from "../core/fandb.ts";
import type { Network } from "../core/chain.ts";
import { FAN_PREFIX } from "../core/fans.ts";
import { isFinal, viewOf, type FanSection, type RecordReader, type RecordStore, type SeriesRecord } from "../core/store.ts";
import type { Series } from "../core/worlds.ts";
import { emptyRecord } from "./pick.ts";

type Records = Pick<RecordReader, "all">;

/** Every fan address that appears in a published fan batch, sorted. */
export function fanAddresses(store: Records): string[] {
  const out = new Set<string>();
  for (const r of store.all()) {
    if (!r.fans?.batch) continue;
    for (const e of (JSON.parse(r.fans.batch) as { entries: { player: string }[] }).entries) {
      if (e.player.startsWith(FAN_PREFIX)) out.add(e.player.slice(FAN_PREFIX.length));
    }
  }
  return [...out].sort();
}

/** Each fan's net AXP over settled (and void, net 0) series (address → net), from the published records. */
export function fanSettledNets(store: Records): Record<string, number> {
  const nets: Record<string, number> = {};
  for (const r of store.all()) {
    if (!isFinal(r)) continue;
    for (const [player, net] of Object.entries(r.axp ?? {})) {
      if (player.startsWith(FAN_PREFIX)) nets[player.slice(FAN_PREFIX.length)] = (nets[player.slice(FAN_PREFIX.length)] ?? 0) + net;
    }
  }
  return nets;
}

/** Each fan's stake and net on every settled series with a committed fan batch (stake covers both markets). A void series is net 0: nothing to claim. */
export function fanResults(store: Records): { matchId: string; address: string; stake: number; net: number }[] {
  const out: { matchId: string; address: string; stake: number; net: number }[] = [];
  for (const r of store.all()) {
    if (!isFinal(r) || r.fans?.status !== "committed" || !r.fans.batch) continue;
    const stakes: Record<string, number> = {};
    for (const e of JSON.parse(r.fans.batch).entries as { player: string; stake: number }[])
      if (e.player.startsWith(FAN_PREFIX)) stakes[e.player.slice(FAN_PREFIX.length)] = (stakes[e.player.slice(FAN_PREFIX.length)] ?? 0) + e.stake;
    for (const [address, stake] of Object.entries(stakes)) out.push({ matchId: r.series.matchId, address, stake, net: r.status === "void" ? 0 : r.axp?.[`${FAN_PREFIX}${address}`] ?? -stake });
  }
  return out;
}

/** Fan commits of series that are final but not stamped settled yet: the AXP sync still owes them. */
export const unsettledFanCommits = (rows: FanCommitRow[], records: SeriesRecord[]): string[] => {
  const byId = viewOf(records);
  return rows.filter((c) => {
    const r = c.settledAt ? null : byId.get(c.matchId);
    return !!r && isFinal(r);
  }).map((c) => c.matchId);
};

/**
 * After settle: writes each fan's per-series results (wins then wait for a claim), then every fan's settled net to Supabase (fans.axp_settled), then stamps the fan commits of settled
 * series, so the API stops holding their stakes as open. In that order, so a stake is never both freed and uncounted.
 */
export async function syncFanAxp(store: RecordStore, db: FanDb, now: Date): Promise<{ fans: number; settledCommits: string[] }> {
  const view = viewOf(await store.all());
  await db.upsertResults(fanResults(view)); // before the nets, so a new win is held for its claim, never spendable early
  const nets = fanSettledNets(view);
  await db.setAxpSettled(nets);
  const settledCommits = unsettledFanCommits(await db.listCommits(), view.all());
  await db.markCommitsSettled(settledCommits, now.toISOString());
  return { fans: Object.keys(nets).length, settledCommits };
}

/** The record section a fan commit row mirrors to. */
export const fanSectionOf = (row: FanCommitRow): FanSection => ({
  status: row.status as FanSection["status"], batch: row.batch, batchHash: row.batchHash, pickCount: row.pickCount, commitDigest: row.commitDigest,
  committedAt: row.committedAt, chain: { network: row.network as Network, packageId: row.packageId },
});

/** Match ids whose fan commit is ready to mirror and differs from the record (the same rule mirrorFanCommits applies), without writing. */
export function fanMirrorPending(records: SeriesRecord[], rows: FanCommitRow[], series: Series[]): string[] {
  const byId = viewOf(records);
  return rows.filter((row) => {
    if (row.status !== "committed" && row.status !== "missed") return false;
    const r = byId.get(row.matchId) ?? (series.some((x) => x.matchId === row.matchId) ? emptyRecord(series.find((x) => x.matchId === row.matchId)!, "missed") : null);
    return !!r && !isFinal(r) && JSON.stringify(r.fans) !== JSON.stringify(fanSectionOf(row));
  }).map((row) => row.matchId);
}

/** Returns the match ids whose record changed. */
export async function mirrorFanCommits(store: RecordStore, rows: FanCommitRow[], series: Series[], log: (msg: string) => void = () => {}): Promise<string[]> {
  const changed: string[] = [];
  for (const row of rows) {
    if (row.status !== "committed" && row.status !== "missed") continue; // a commit in flight is mirrored next run
    const s = series.find((x) => x.matchId === row.matchId);
    const r = (await store.get(row.matchId)) ?? (s ? emptyRecord(s, "missed") : null);
    if (!r) continue;
    const fans = fanSectionOf(row);
    if (JSON.stringify(r.fans) === JSON.stringify(fans)) continue;
    if (isFinal(r)) {
      // AXP is already settled (or the series voided); adding fans now would change it after the fact.
      log(`${row.matchId}: fan batch arrived after settlement, not mirrored`);
      continue;
    }
    // A record the analysts never committed takes the fans' chain, where its result will be posted.
    await store.put({ ...r, fans, chain: r.chain ?? (r.commitDigest ? undefined : fans.chain) });
    changed.push(row.matchId);
  }
  return changed;
}

/**
 * The tick's fan step: ping Supabase (keeps a free project awake), mirror fan commits into the records, and refresh the
 * fans' display names when they changed. Throws when Supabase can't be read, so the caller can hold settlement back.
 */
export async function mirrorFans(store: RecordStore, db: FanDb, fetchSeries: () => Promise<Series[]>, log: (msg: string) => void): Promise<{ mirrored: string[]; namesChanged: boolean }> {
  await db.ping();
  const mirrored = await mirrorFanCommits(store, await db.listCommits(), await fetchSeries(), log);
  const names = await db.fanNames(fanAddresses(viewOf(await store.all())));
  const namesChanged = JSON.stringify(names) !== JSON.stringify(await store.readFanNames());
  if (namesChanged) await store.writeFanNames(names);
  return { mirrored, namesChanged };
}
