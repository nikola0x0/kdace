// Server-side data for the pages: published records from ../data, plus the schedule and team logos fetched at build time.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { aiConsensus } from "../../src/core/consensus.ts";
import { chainOf, type Chain } from "../../src/core/chain.ts";
import { titleHistory, type TitleDay } from "../../src/core/titles.ts";
import { AXP_START } from "../../src/core/points.ts";
import { FAN_PREFIX, displayName } from "../../src/core/fans.ts";
import type { SeriesRecord } from "../../src/core/store.ts";
import { fetchSeries, fetchTeamLogos, type Series } from "../../src/core/worlds.ts";
import { store } from "./data";
import { PERSONAS, persona } from "./personas";

export type AnalystCall = { player: string; name: string; title: string; color: string; art: string | null; winner: string; score: string | null; prob: number; stake: number; reasoning: string; thinking: string | null; recalled: { blobId: string; text: string; createdAt: string }[]; /** The analyst's final-call top-up on its side (committed), or null. */ topUp: { add: number; reasoning: string } | null };

export type CardData = {
  series: Series;
  logoA: string | null;
  logoB: string | null;
  stageArt: string | null;
  stageKey: string;
  calls: AnalystCall[];
  consensusA: number | null;
  status: SeriesRecord["status"] | "open";
  /** The official result; null before it and for a void series. */
  result: { winner: string; score: string } | null;
  /** No official result 48 h after the start (or cancelled): every stake refunded. */
  void: boolean;
  /** AXP the analysts have on each team's win: morning stakes plus committed final-call top-ups. */
  aiPool: Record<string, number>;
};

/** A public art file if the user has dropped it into web/public/art, else null (a placeholder is drawn). */
export function art(file: string): string | null {
  for (const ext of [".webp", ".png", ".jpg"]) if (existsSync(join(process.cwd(), "public", "art", file + ext))) return `/art/${file}${ext}`;
  return null;
}

export const stageKey = (block: string) => {
  const b = block.toLowerCase();
  return b.includes("final") && !b.includes("semi") && !b.includes("quarter") ? "final" : b.includes("semi") ? "semifinals" : b.includes("quarter") ? "quarterfinals" : "swiss";
};

let logosCache: Promise<Record<string, string>> | undefined;
export const teamLogos = () => (logosCache ??= fetchTeamLogos().catch(() => ({}) as Record<string, string>));

let scheduleCache: Promise<Series[]> | undefined;
export const schedule = () => (scheduleCache ??= fetchSeries().catch(() => []));

export const records = () => store().all().sort((a, b) => a.series.startTime.localeCompare(b.series.startTime));
export const board = () => store().readBoard();
/** The latest day of committed title calls (who wins Worlds), or null before the first. */
export const titleDay = (): TitleDay | null => store().titleDays().filter((d) => d.status === "committed").pop() ?? null;
/** One analyst's title calls over time, oldest first. */
export const titleCallsOf = (player: string) => titleHistory(store().titleDays())[player] ?? [];
export const fanNames = () => store().readFanNames();

export function nameOf(player: string, names = fanNames()) {
  const p = persona(player);
  if (p) return p.name;
  return player.startsWith(FAN_PREFIX) ? displayName(player, names[player.slice(FAN_PREFIX.length)]) : player;
}

export function callsOf(r: SeriesRecord | undefined): AnalystCall[] {
  if (!r) return [];
  return PERSONAS.flatMap((p) => {
    const pick = r.picks.find((x) => x.player === p.player);
    if (!pick) return [];
    return [{ player: p.player, name: p.name, title: p.title, color: p.color, art: art(`analyst-${p.role}`), winner: pick.winner, score: pick.score, prob: pick.winProbability, stake: (pick as { stake?: number }).stake ?? 0, reasoning: pick.reasoning, thinking: pick.thinking || null, recalled: pick.usedLessons ?? [], topUp: topUpOf(r, p.player) }];
  });
}

/** An analyst's committed final-call top-up (only adds above 0 are on chain). */
export function topUpOf(r: SeriesRecord, player: string): { add: number; reasoning: string } | null {
  if (r.finalCall?.status !== "committed") return null;
  const c = r.finalCall.calls.find((x) => x.player === player && x.add > 0);
  return c ? { add: c.add, reasoning: c.reasoning } : null;
}

/** The analysts' AXP on each team's win: each call's stake plus its final-call top-up. */
export function aiPool(calls: AnalystCall[]): Record<string, number> {
  const pool: Record<string, number> = {};
  for (const a of calls) pool[a.winner] = (pool[a.winner] ?? 0) + a.stake + (a.topUp?.add ?? 0);
  return pool;
}

export async function cardFor(s: Series, r: SeriesRecord | undefined): Promise<CardData> {
  const logos = await teamLogos();
  const key = stageKey(s.block);
  const calls = callsOf(r);
  const isVoid = r?.status === "void";
  return {
    series: r?.series ?? s,
    logoA: logos[s.teamA] ?? null,
    logoB: logos[s.teamB] ?? null,
    stageArt: art(`stage-${key}`),
    stageKey: key,
    calls,
    consensusA: r ? aiConsensus(r.picks, r.series.teamA) : null,
    status: r?.status ?? "open",
    result: r?.result && !isVoid ? { winner: r.result.winner, score: r.result.score } : null,
    void: isVoid,
    aiPool: aiPool(calls),
  };
}

/** Upcoming series (teams known, not started) merged from the live schedule and the published records. */
export async function upcomingCards(): Promise<CardData[]> {
  const recs = new Map(records().map((r) => [r.series.matchId, r]));
  const fromSchedule = (await schedule()).filter((s) => s.state === "unstarted" && s.teamA !== "TBD" && s.teamB !== "TBD");
  const ids = new Set(fromSchedule.map((s) => s.matchId));
  const extra = records().filter((r) => r.status === "committed" && !ids.has(r.series.matchId)).map((r) => r.series);
  const all = [...fromSchedule, ...extra].sort((a, b) => a.startTime.localeCompare(b.startTime));
  return Promise.all(all.map((s) => cardFor(s, recs.get(s.matchId))));
}

export async function settledCards(): Promise<CardData[]> {
  return Promise.all(records().filter((r) => r.status === "settled" || r.status === "void").reverse().map((r) => cardFor(r.series, r)));
}

export function counters() {
  const all = records();
  return {
    memories: all.reduce((n, r) => n + r.lessons.filter((l) => l.blobId).length, 0),
    committed: all.filter((r) => r.commitDigest).length,
    settled: all.filter((r) => r.status === "settled").length,
  };
}

export const suiscan = (r: { chain?: Chain }, digest: string | null | undefined) => `https://suiscan.xyz/${chainOf(r).network}/tx/${digest}`;
export const walruscan = (blobId: string) => `https://walruscan.com/mainnet/blob/${blobId}`;
export const lessonText = (text: string) => text.split(" (from ")[0];

export type AnalystStats = { calls: number; settled: number; correct: number; accuracy: number | null; /** AXP free to bet (total − in play). */ balance: number; /** Balance + AXP in play (what the board ranks by). */ total: number; net: number; roi: number | null; staked: number; inPlay: number; best: number; memories: number; recalled: number; form: ("W" | "L")[] };

/** One analyst's record: winner-call accuracy over settled series, board numbers, memories saved and recalled, last five results. */
export function analystStats(player: string): AnalystStats {
  const all = records();
  const row = board().find((r) => r.player === player);
  let calls = 0, settled = 0, correct = 0, memories = 0, recalled = 0, staked = 0, inPlay = 0, best = 0;
  const form: ("W" | "L")[] = [];
  for (const r of all) {
    const pick = r.picks.find((p) => p.player === player);
    memories += r.lessons.filter((l) => l.player === player && l.blobId).length;
    if (!pick) continue;
    calls++;
    recalled += pick.usedLessons?.length ?? 0;
    if (r.status === "void") continue; // refunded: no stake, no result
    // Final-call top-ups count once on chain (committed), or as in play while their commit is in flight.
    const topUp = r.finalCall?.status === "committed" || r.finalCall?.status === "committing" ? (r.finalCall.calls.find((c) => c.player === player)?.add ?? 0) : 0;
    const stake = ((pick as { stake?: number }).stake ?? 0) + ((pick as { scoreStake?: number }).scoreStake ?? 0) + topUp;
    if (r.axp) {
      staked += stake;
      best = Math.max(best, r.axp[player] ?? 0);
    } else if (r.status === "committed" || r.status === "committing") inPlay += stake;
    if (r.result) {
      settled++;
      const win = pick.winner === r.result.winner;
      if (win) correct++;
      form.push(win ? "W" : "L");
    }
  }
  const net = row?.net ?? 0;
  return { calls, settled, correct, accuracy: settled ? Math.round((correct / settled) * 100) : null, balance: (row?.balance ?? AXP_START) - inPlay, total: row?.balance ?? AXP_START, net, roi: staked ? Math.round((net / staked) * 100) : null, staked, inPlay, best, memories, recalled, form: form.slice(-5) };
}

/** What the in-browser verifier needs for one series (all public, straight from the published record). */
export function verifyInput(r: SeriesRecord) {
  const chain = chainOf(r);
  return {
    network: chain.network,
    packageId: chain.packageId,
    matchId: r.series.matchId,
    startTime: r.series.startTime,
    batch: r.commitDigest ? r.batch : null,
    commitDigest: r.commitDigest,
    fansBatch: r.fans?.commitDigest ? r.fans.batch : null,
    fansDigest: r.fans?.commitDigest ?? null,
    result: r.result,
    memories: r.picks.flatMap((p) => (p.usedLessons ?? []).map((l) => ({ player: p.player, blobId: l.blobId, savedAt: l.createdAt, pickedAt: p.pickedAt }))),
    thoughts: r.picks.flatMap((p) => (p.thinking !== undefined && p.stake > 0 ? [{ player: p.player, reasoning: p.reasoning, thinking: p.thinking }] : [])),
    ...(r.finalCall?.status === "committed"
      ? { finalBatch: r.finalCall.batch, finalDigest: r.finalCall.commitDigest, finalCalls: r.finalCall.calls.map((c) => ({ player: c.player, add: c.add, side: r.picks.find((p) => p.player === c.player)?.winner ?? "" })) }
      : {}),
  };
}

/** Every individual pick locked on Sui so far: analysts' and fans' batch entries. */
export function picksLocked() {
  const count = (batch: string | null | undefined) => (batch ? (JSON.parse(batch) as { entries: unknown[] }).entries.length : 0);
  return records().reduce((n, r) => n + (r.commitDigest ? count(r.batch) : 0) + (r.finalCall?.commitDigest ? count(r.finalCall.batch) : 0) + (r.fans?.commitDigest ? count(r.fans.batch) : 0), 0);
}
