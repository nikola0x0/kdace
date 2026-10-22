// Fan stage of the tick: copy each fan-batch commit from Supabase into data/series/<matchId>.json, so verify and the
// static site read it from git like everything else. Runs before settle, so points include the fans.
import type { FanCommitRow } from "../core/fandb.ts";
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
      // Points are already final; adding fans now would change them after the fact.
      log(`${row.matchId}: fan batch arrived after settlement, not mirrored`);
      continue;
    }
    // A record the analysts never committed takes the fans' chain, where its result will be posted.
    store.put({ ...r, fans, chain: r.chain ?? (r.commitDigest ? undefined : fans.chain) });
    changed.push(row.matchId);
  }
  return changed;
}
