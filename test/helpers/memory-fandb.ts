// In-memory FanDb for tests: same semantics as the Supabase tables (unique keys, conditional updates, the referee lock).
import type { FanCommitRow, FanDb, FanRow } from "../../src/core/fandb.ts";
import type { FanPickRow } from "../../src/core/fans.ts";

export class MemoryFanDb implements FanDb {
  fans = new Map<string, FanRow>();
  picks = new Map<string, FanPickRow>();
  commits = new Map<string, FanCommitRow>();
  lockHolder: string | null = null;
  pings = 0;

  async getFan(address: string) {
    return this.fans.get(address) ?? null;
  }
  async ensureFan(address: string) {
    if (!this.fans.has(address)) this.fans.set(address, { address, suinsName: null, suinsCheckedAt: null, createdAt: new Date().toISOString() });
  }
  async setSuins(address: string, name: string | null, checkedAt: string) {
    const f = this.fans.get(address);
    if (f) this.fans.set(address, { ...f, suinsName: name, suinsCheckedAt: checkedAt });
  }
  async fanNames(addresses: string[]) {
    return Object.fromEntries(addresses.flatMap((a) => (this.fans.has(a) ? [[a, this.fans.get(a)!.suinsName]] : [])));
  }
  async upsertPick(row: FanPickRow) {
    this.picks.set(`${row.matchId}|${row.address}|${row.market}`, { ...row });
  }
  async picksFor(matchIds: string[]) {
    return [...this.picks.values()].filter((p) => matchIds.includes(p.matchId));
  }
  async picksOf(address: string) {
    return [...this.picks.values()].filter((p) => p.address === address);
  }
  async listCommits() {
    return [...this.commits.values()].map((c) => ({ ...c }));
  }
  async insertCommit(row: FanCommitRow) {
    if (this.commits.has(row.matchId)) return false;
    this.commits.set(row.matchId, { ...row });
    return true;
  }
  async updateCommit(matchId: string, patch: Partial<FanCommitRow>, ifAttemptedAt?: string) {
    const c = this.commits.get(matchId);
    if (!c || (ifAttemptedAt !== undefined && c.attemptedAt !== ifAttemptedAt)) return false;
    this.commits.set(matchId, { ...c, ...patch });
    return true;
  }
  async acquireRefereeLock(holder: string, _ttlSeconds = 120) {
    if (this.lockHolder && this.lockHolder !== holder) return false;
    this.lockHolder = holder;
    return true;
  }
  async releaseRefereeLock(holder: string) {
    if (this.lockHolder === holder) this.lockHolder = null;
  }
  async ping() {
    this.pings++;
  }
}
