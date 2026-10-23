// Fan stage of the tick: copy each fan-batch commit from Supabase into data/series/<matchId>.json, so verify and the
// static site read it from git like everything else. Runs before settle, so AXP settlement includes the fans.
import type { FanCommitRow, FanDb } from "../core/fandb.ts";
import type { Network } from "../core/chain.ts";
import { FAN_PREFIX } from "../core/fans.ts";
import type { FanSection, Store } from "../core/store.ts";
import type { Series } from "../core/worlds.ts";
import { emptyRecord } from "./pick.ts";

/** Every fan address that appears in a published fan batch, sorted. */
export function fanAddresses(store: Store): string[] {
  const out = new Set<string>();
  for (const r of store.all()) {
    if (!r.fans?.batch) continue;
    for (const e of (JSON.parse(r.fans.batch) as { entries: { player: string }[] }).entries) {
      if (e.player.startsWith(FAN_PREFIX)) out.add(e.player.slice(FAN_PREFIX.length));
    }
  }
  return [...out].sort();
}

/** Each fan's net AXP over settled series (address → net), from the published records. */
export function fanSettledNets(store: Store): Record<string, number> {
  const nets: Record<string, number> = {};
  for (const r of store.all()) {
    if (r.status !== "settled") continue;
    for (const [player, net] of Object.entries(r.axp ?? {})) {
      if (player.startsWith(FAN_PREFIX)) nets[player.slice(FAN_PREFIX.length)] = (nets[player.slice(FAN_PREFIX.length)] ?? 0) + net;
    }
  }
  return nets;
}

/** Each fan's stake and net on every settled series with a committed fan batch (stake covers both markets). */
export function fanResults(store: Store): { matchId: string; address: string; stake: number; net: number }[] {
  const out: { matchId: string; address: string; stake: number; net: number }[] = [];
  for (const r of store.all()) {
    if (r.status !== "settled" || r.fans?.status !== "committed" || !r.fans.batch) continue;
    const stakes: Record<string, number> = {};
    for (const e of JSON.parse(r.fans.batch).entries as { player: string; stake: number }[])
      if (e.player.startsWith(FAN_PREFIX)) stakes[e.player.slice(FAN_PREFIX.length)] = (stakes[e.player.slice(FAN_PREFIX.length)] ?? 0) + e.stake;
    for (const [address, stake] of Object.entries(stakes)) out.push({ matchId: r.series.matchId, address, stake, net: r.axp?.[`${FAN_PREFIX}${address}`] ?? -stake });
  }
  return out;
}

/**
 * After settle: writes each fan's per-series results (wins then wait for a claim), then every fan's settled net to Supabase (fans.axp_settled), then stamps the fan commits of settled
 * series, so the API stops holding their stakes as open. In that order, so a stake is never both freed and uncounted.
 */
export async function syncFanAxp(store: Store, db: FanDb, now: Date): Promise<{ fans: number; settledCommits: string[] }> {
  await db.upsertResults(fanResults(store)); // before the nets, so a new win is held for its claim, never spendable early
  const nets = fanSettledNets(store);
  await db.setAxpSettled(nets);
  const settledCommits = (await db.listCommits()).filter((c) => !c.settledAt && store.get(c.matchId)?.status === "settled").map((c) => c.matchId);
  await db.markCommitsSettled(settledCommits, now.toISOString());
  return { fans: Object.keys(nets).length, settledCommits };
}

/** Returns the match ids whose record changed. */
export function mirrorFanCommits(store: Store, rows: FanCommitRow[], series: Series[], log: (msg: string) => void = () => {}): string[] {
  const changed: string[] = [];
  for (const row of rows) {
    if (row.status !== "committed" && row.status !== "missed") continue; // a commit in flight is mirrored next run
    const s = series.find((x) => x.matchId === row.matchId);
    const r = store.get(row.matchId) ?? (s ? emptyRecord(s, "missed") : null);
    if (!r) continue;
    const fans: FanSection = {
      status: row.status, batch: row.batch, batchHash: row.batchHash, pickCount: row.pickCount, commitDigest: row.commitDigest,
      committedAt: row.committedAt, chain: { network: row.network as Network, packageId: row.packageId },
    };
    if (JSON.stringify(r.fans) === JSON.stringify(fans)) continue;
    if (r.status === "settled") {
      // AXP is already settled; adding fans now would change it after the fact.
      log(`${row.matchId}: fan batch arrived after settlement, not mirrored`);
      continue;
    }
    // A record the analysts never committed takes the fans' chain, where its result will be posted.
    store.put({ ...r, fans, chain: r.chain ?? (r.commitDigest ? undefined : fans.chain) });
    changed.push(row.matchId);
  }
  return changed;
}
