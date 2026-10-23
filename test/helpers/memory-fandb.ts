// In-memory FanDb for tests: same semantics as the Supabase tables (unique keys, conditional updates, the referee lock).
import { isCustomAvatar, type FanAuth, type FanCommitRow, type FanDb, type FanResultRow, type FanRow } from "../../src/core/fandb.ts";
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
      this.fans.set(address, { ...f, authMethod: auth.method, zkloginSalt: auth.zkloginSalt ?? f.zkloginSalt, avatarUrl: isCustomAvatar(f.avatarUrl) ? f.avatarUrl : auth.avatarUrl ?? f.avatarUrl ?? null });
    }
  }
  async setSuins(address: string, name: string | null, checkedAt: string) {
    const f = this.fans.get(address);
    if (f) this.fans.set(address, { ...f, suinsName: name, suinsCheckedAt: checkedAt });
  }
  async fanNames(addresses: string[]) {
    return Object.fromEntries(addresses.flatMap((a) => (this.fans.has(a) ? [[a, this.fans.get(a)!.nickname || this.fans.get(a)!.suinsName]] : [])));
  }
  async listFans() {
    return [...this.fans.values()].map((f) => ({ address: f.address, suinsName: f.suinsName ?? null, axpSettled: f.axpSettled ?? 0, avatarUrl: f.avatarUrl ?? null, favRole: f.favRole ?? null, favChamps: f.favChamps ?? [], nickname: f.nickname ?? null }));
  }
  async setCustomAvatar(address: string, image: { bytes: Uint8Array; type: string } | null) {
    const f = this.fans.get(address);
    const url = image ? `https://storage.test/storage/v1/object/public/avatars/${address}?v=${image.bytes.length}` : null;
    if (f) this.fans.set(address, { ...f, avatarUrl: url });
    return url;
  }
  async setNickname(address: string, nickname: string | null) {
    const f = this.fans.get(address);
    if (f) this.fans.set(address, { ...f, nickname });
  }
  async setFavChamps(address: string, champs: string[]) {
    const f = this.fans.get(address);
    if (f) this.fans.set(address, { ...f, favChamps: champs });
  }
  async setFavRole(address: string, role: string | null) {
    const f = this.fans.get(address);
    if (f) this.fans.set(address, { ...f, favRole: role });
  }
  async upsertPick(row: FanPickRow) {
    this.picks.set(`${row.matchId}|${row.address}|${row.market}|${row.choice}`, { ...row });
  }
  buys: { id: number; matchId: string; address: string; market: string; choice: string; amount: number; at: string }[] = [];
  async recentBuys(limit: number, matchId?: string) {
    return this.buys.filter((b) => !matchId || b.matchId === matchId).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id).slice(0, limit);
  }
  resultRows = new Map<string, FanResultRow>();
  async upsertResults(rows: Omit<FanResultRow, "claimedAt">[]) {
    for (const r of rows) {
      const key = `${r.matchId}|${r.address}`;
      this.resultRows.set(key, { ...r, claimedAt: this.resultRows.get(key)?.claimedAt ?? null });
    }
  }
  async results(address?: string) {
    return [...this.resultRows.values()].filter((r) => (address ? r.address === address : r.claimedAt === null && r.net > 0)).map((r) => ({ ...r }));
  }
  async claimResult(matchId: string, address: string, at: string) {
    const r = this.resultRows.get(`${matchId}|${address}`);
    if (!r || r.claimedAt !== null || r.net <= 0) return null;
    r.claimedAt = at;
    return { ...r };
  }
  async buysOf(address: string) {
    return this.buys.filter((b) => b.address === address).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  }
  async buyPick(row: FanPickRow) {
    if ([...this.picks.values()].some((p) => p.matchId === row.matchId && p.address === row.address && p.market === row.market && p.choice !== row.choice)) throw new Error("Supabase POST rpc/buy_pick HTTP 400: other_side");
    this.buys.push({ id: this.buys.length + 1, matchId: row.matchId, address: row.address, market: row.market, choice: row.choice, amount: row.stake, at: row.updatedAt });
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
