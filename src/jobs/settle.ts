// Settle job, in two parts. Fast (first in the tick): post each finished series' result on Sui, settle its AXP bets and
// write the board; or void a series with no official result 48 h after its start (VOID on chain, every stake refunded).
// Slow (last in the tick): the analysts' debate and one lesson per analyst on Walrus Memory.
// Every step is saved before the next, so a crash resumes without posting or remembering twice.
import { pathToFileURL } from "node:url";
import { withLock } from "../core/lock.ts";
import { ANALYSTS, buildReflectPrompt, type Role } from "../core/analysts.ts";
import { chainOf, sameChain, type Chain } from "../core/chain.ts";
import { fanDbFromEnv, withRefereeLock } from "../core/fandb.ts";
import { computeBoard, marketNet } from "../core/points.ts";
import { settleAction, VOID } from "../core/results.ts";
import { awaitingResult } from "../core/select.ts";
import { Store, toSettled, voidNet, type SeriesRecord } from "../core/store.ts";
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
  now(): Date;
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

/** Result on chain, then AXP, then "settled" (or "void"); each saved before the next step. */
async function finishOne(deps: SettleDeps, matchId: string, result: { winner: string; score: string }, isVoid: boolean) {
  let r = deps.store.get(matchId)!;
  const save = (next: SeriesRecord) => (deps.store.put(next), (r = next));
  // r.series keeps the snapshot from commit time; the official feed is only used for the result.
  if (!r.result) save({ ...r, result: { ...result, resultDigest: await deps.postResult(matchId, result.winner, result.score) } });
  if (!r.axp) save({ ...r, axp: isVoid ? voidNet(r) : marketNet(toSettled(r)) });
  save({ ...r, status: isVoid ? "void" : "settled" });
  deps.log(`${matchId} ${r.series.teamA} vs ${r.series.teamB}: ${isVoid ? "void, every stake refunded" : `${result.winner} ${result.score}`}`);
}

/**
 * Fast part: settles or voids every record awaiting its result, then writes the board. If the schedule can't be fetched,
 * results already posted are still finished, and nothing new is posted or voided.
 */
export async function runSettleFast(deps: SettleDeps): Promise<{ settled: string[]; voided: string[] }> {
  const out = { settled: [] as string[], voided: [] as string[] };
  let schedule: Series[] | null = null;
  try {
    schedule = await deps.fetchSeries();
  } catch (e) {
    deps.log(`schedule unavailable, only finishing results already posted: ${(e as Error).message}`);
  }
  const byId = new Map((schedule ?? []).map((s) => [s.matchId, s]));
  for (const r of deps.store.all().filter(awaitingResult)) {
    const id = r.series.matchId;
    const action = settleAction(r, byId.get(id), schedule !== null, deps.now());
    if (action.kind === "wait") {
      if (byId.get(id)?.state === "completed") deps.log(`${id} ${action.reason}; will retry`);
      continue;
    }
    if (!r.result && !sameChain(chainOf(r), deps.chain)) {
      deps.log(`${id} was committed on ${chainOf(r).network}; its result must be posted there, skipping`);
      continue;
    }
    try {
      if (action.kind === "void") {
        deps.log(`${id} voiding: ${action.reason}`);
        await finishOne(deps, id, { winner: VOID, score: VOID }, true);
        out.voided.push(id);
      } else {
        await finishOne(deps, id, action.result, false);
        out.settled.push(id);
      }
    } catch (e) {
      deps.log(`${id} settle failed, will resume next run: ${(e as Error).message}`);
    }
  }
  deps.store.writeBoard(computeBoard(deps.store.all().filter((x) => x.status === "settled").map(toSettled)));
  return out;
}

const needsReflection = (r: SeriesRecord) => r.status === "settled" && !!r.result && r.picks.length > 0 && (!r.debate || r.picks.some((p) => !r.lessons.find((l) => l.player === p.player)?.blobId));

/** Slow part: for settled series, the debate, then one lesson per analyst (saved with its job id before waiting). */
export async function runSettleSlow(deps: SettleDeps): Promise<{ reflected: string[] }> {
  const reflected: string[] = [];
  for (const start of deps.store.all().filter(needsReflection)) {
    let r = start;
    const save = (next: SeriesRecord) => (deps.store.put(next), (r = next));
    const result = r.result!;
    try {
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
      deps.log(`${r.series.matchId} ${r.series.teamA} vs ${r.series.teamB}: debate and ${r.lessons.length} lessons saved`);
      reflected.push(r.series.matchId);
    } catch (e) {
      deps.log(`${r.series.matchId} debate/lessons failed, will resume next run: ${(e as Error).message}`);
    }
  }
  return { reflected };
}

/** Both parts in order (the CLI; the tick runs them separately, with the picks in between). */
export async function runSettle(deps: SettleDeps): Promise<{ settled: string[]; voided: string[]; reflected: string[] }> {
  const fast = await runSettleFast(deps);
  return { ...fast, ...(await runSettleSlow(deps)) };
}

export async function realSettleDeps(store = new Store()): Promise<SettleDeps> {
  const { fetchSeries } = await import("../core/worlds.ts");
  const { memory } = await import("../core/memory.ts");
  const { askAnalyst } = await import("../core/llm.ts");
  const { currentChain, postResult } = await import("../core/ledger.ts");
  return {
    fetchSeries,
    store,
    // Shares the Referee with the fan lock route; the Supabase mutex keeps their transactions apart.
    postResult: (matchId, winner, score) => withRefereeLock(fanDbFromEnv(), "tick", () => postResult(matchId, winner, score), { waitMs: 5 * 60_000, proceedIfDbDown: true }),
    ask: async (prompt) => askAnalyst(prompt),
    startRemember: async (role, text) => {
      const ns = `kdace-analyst-${role}`;
      return (await memory(ns).rememberAsync(text, ns)).job_id;
    },
    awaitRemember: async (role, jobId) => (await memory(`kdace-analyst-${role}`).waitForRememberJob(jobId, { timeoutMs: 90_000 })).blob_id,
    chain: currentChain(),
    now: () => new Date(),
    log: (msg) => console.log(`[settle] ${msg}`),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const out = await withLock("data", async () => runSettle(await realSettleDeps()));
  console.log(`[settle] settled ${out.settled.length}, voided ${out.voided.length}, reflected ${out.reflected.length}`);
  process.exit(0);
}
