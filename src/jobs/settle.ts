// Settle job: post each finished series' result, score it, run the analysts' debate, and save one lesson per analyst.
// Every step is saved before the next, so a crash resumes without posting or remembering twice.
import { pathToFileURL } from "node:url";
import { withLock } from "../core/lock.ts";
import { ANALYSTS, buildReflectPrompt, type Role } from "../core/analysts.ts";
import { chainOf, sameChain, type Chain } from "../core/chain.ts";
import { computeBoard, marketPoints } from "../core/points.ts";
import { seriesToSettle } from "../core/select.ts";
import { Store, toSettled, type SeriesRecord } from "../core/store.ts";
import type { Series } from "../core/worlds.ts";

export type SettleDeps = {
  fetchSeries(): Promise<Series[]>;
  store: Store;
  postResult(matchId: string, winner: string, score: string): Promise<string>;
  ask(prompt: string): Promise<string>;
  /** Queue a Walrus Memory write; returns the relayer job id. */
  startRemember(role: Role, text: string): Promise<string>;
  /** Wait for a queued write; returns the blob id. */
  awaitRemember(role: Role, jobId: string): Promise<string>;
  /** Where postResult() writes; a result must land on the same network as its commit. */
  chain: Chain;
  log(msg: string): void;
};

function debatePrompt(r: SeriesRecord, result: { winner: string; score: string }): string {
  const lines = r.picks.map((p) => {
    const a = ANALYSTS.find((x) => x.player === p.player)!;
    return `- ${a.name} (${a.belief}) picked ${p.winner}${p.score ? ` ${p.score}` : ""} at ${p.winProbability}%: "${p.reasoning}"`;
  });
  return `Five LoL analysts on KDAce just saw ${r.series.teamA} vs ${r.series.teamB} (best of ${r.series.bestOf}) end: ${result.winner} won ${result.score}.
Their pre-game picks:
${lines.join("\n")}

Write the debate: exactly one short line per analyst who picked, in their own voice, reacting to the result and to each other (teasing is fine, stay friendly). Format each line as "<Name>: <line>". No other text.`;
}

/** The official result, or null when the feed is not final yet (no winner, unfinished score, unknown team). */
function officialResult(s: Series): { winner: string; score: string } | null {
  const winsW = Math.max(s.winsA ?? 0, s.winsB ?? 0);
  const winsL = Math.min(s.winsA ?? 0, s.winsB ?? 0);
  const winnerWins = s.winner === s.teamA ? s.winsA : s.winsB;
  if ((s.winner !== s.teamA && s.winner !== s.teamB) || winnerWins !== winsW || winsW !== Math.ceil(s.bestOf / 2) || winsL >= winsW) return null;
  return { winner: s.winner, score: `${winsW}-${winsL}` };
}

async function settleOne(deps: SettleDeps, s: Series, result: { winner: string; score: string }) {
  let r = deps.store.get(s.matchId)!;
  const save = (next: SeriesRecord) => (deps.store.put(next), (r = next));
  // r.series keeps the snapshot from commit time; the official feed is only used for the result.
  if (!r.result) save({ ...r, result: { ...result, resultDigest: await deps.postResult(s.matchId, result.winner, result.score) } });
  if (!r.points) save({ ...r, points: marketPoints(toSettled(r)) });
  if (!r.debate) save({ ...r, debate: (await deps.ask(debatePrompt(r, result))).trim() });
  for (const pick of r.picks) {
    const a = ANALYSTS.find((x) => x.player === pick.player)!;
    let lesson = r.lessons.find((l) => l.player === pick.player);
    if (lesson?.blobId) continue;
    if (!lesson) {
      const text = `${(await deps.ask(buildReflectPrompt(a, r.series, pick, result, r.debate!))).trim()} (from ${r.series.block} ${r.series.teamA} vs ${r.series.teamB}; picked ${pick.winner}${pick.score ? ` ${pick.score}` : ""}, actual ${result.winner} ${result.score})`;
      // Saved with its job id before waiting, so a timeout resumes the same write instead of storing the lesson twice.
      lesson = { player: pick.player, text, blobId: "", jobId: await deps.startRemember(a.role, text) };
      save({ ...r, lessons: [...r.lessons, lesson] });
    }
    const blobId = await deps.awaitRemember(a.role, lesson.jobId!);
    save({ ...r, lessons: r.lessons.map((l) => (l.player === pick.player ? { ...l, blobId } : l)) });
  }
  save({ ...r, status: "settled" });
  deps.log(`${s.matchId} ${r.series.teamA} vs ${r.series.teamB}: ${result.winner} ${result.score}, ${r.lessons.length} lessons`);
}

export async function runSettle(deps: SettleDeps): Promise<{ settled: string[] }> {
  const settled: string[] = [];
  for (const s of seriesToSettle(await deps.fetchSeries(), deps.store)) {
    const result = officialResult(s);
    if (!result) {
      deps.log(`${s.matchId} marked completed but the result is not final yet; will retry`);
      continue;
    }
    const r = deps.store.get(s.matchId)!;
    if (!r.result && !sameChain(chainOf(r), deps.chain)) {
      deps.log(`${s.matchId} was committed on ${chainOf(r).network}; its result must be posted there, skipping`);
      continue;
    }
    try {
      await settleOne(deps, s, result);
      settled.push(s.matchId);
    } catch (e) {
      deps.log(`${s.matchId} settle failed, will resume next run: ${(e as Error).message}`);
    }
  }
  deps.store.writeBoard(computeBoard(deps.store.all().filter((x) => x.status === "settled").map(toSettled)));
  return { settled };
}

export async function realSettleDeps(store = new Store()): Promise<SettleDeps> {
  const { fetchSeries } = await import("../core/worlds.ts");
  const { memory } = await import("../core/memory.ts");
  const { askAnalyst } = await import("../core/llm.ts");
  const { currentChain, postResult } = await import("../core/ledger.ts");
  return {
    fetchSeries,
    store,
    postResult,
    ask: async (prompt) => askAnalyst(prompt),
    startRemember: async (role, text) => {
      const ns = `kdace-analyst-${role}`;
      return (await memory(ns).rememberAsync(text, ns)).job_id;
    },
    awaitRemember: async (role, jobId) => (await memory(`kdace-analyst-${role}`).waitForRememberJob(jobId, { timeoutMs: 90_000 })).blob_id,
    chain: currentChain(),
    log: (msg) => console.log(`[settle] ${msg}`),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { settled } = await withLock("data", async () => runSettle(await realSettleDeps()));
  console.log(`[settle] settled ${settled.length}`);
  process.exit(0);
}
