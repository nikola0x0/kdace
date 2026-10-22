// In-memory FanDb for tests: same semantics as the Supabase tables (unique keys, conditional updates, the referee lock).
import type { FanAuth, FanCommitRow, FanDb, FanRow } from "../../src/core/fandb.ts";
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
  async ensureFan(address: string, auth?: FanAuth) {
    if (!this.fans.has(address)) this.fans.set(address, { address, suinsName: null, suinsCheckedAt: null, createdAt: new Date().toISOString(), authMethod: null, zkloginSalt: null });
    if (auth) {
      const f = this.fans.get(address)!;
      this.fans.set(address, { ...f, authMethod: auth.method, zkloginSalt: auth.zkloginSalt ?? f.zkloginSalt, avatarUrl: auth.avatarUrl ?? f.avatarUrl ?? null });
    }
  }
  async setSuins(address: string, name: string | null, checkedAt: string) {
    const f = this.fans.get(address);
    if (f) this.fans.set(address, { ...f, suinsName: name, suinsCheckedAt: checkedAt });
  }
  async fanNames(addresses: string[]) {
    return Object.fromEntries(addresses.flatMap((a) => (this.fans.has(a) ? [[a, this.fans.get(a)!.suinsName]] : [])));
  }
  async listFans() {
    return [...this.fans.values()].map((f) => ({ address: f.address, suinsName: f.suinsName ?? null, axpSettled: f.axpSettled ?? 0, avatarUrl: f.avatarUrl ?? null }));
  }
  async upsertPick(row: FanPickRow) {
    this.picks.set(`${row.matchId}|${row.address}|${row.market}|${row.choice}`, { ...row });
  }
  async buyPick(row: FanPickRow) {
    const key = `${row.matchId}|${row.address}|${row.market}|${row.choice}`;
    const next = { ...row, stake: (this.picks.get(key)?.stake ?? 0) + row.stake };
    this.picks.set(key, next);
    return { ...next };
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
  async setAxpSettled(nets: Record<string, number>) {
    for (const [address, net] of Object.entries(nets)) {
      await this.ensureFan(address);
      this.fans.set(address, { ...this.fans.get(address)!, axpSettled: net });
    }
  }
  async markCommitsSettled(matchIds: string[], at: string) {
    for (const id of matchIds) {
      const c = this.commits.get(id);
      if (c && !c.settledAt) this.commits.set(id, { ...c, settledAt: at });
    }
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
