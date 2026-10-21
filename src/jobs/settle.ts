// Settle job: post each finished series' result, score it, run the analysts' debate, and save one lesson per analyst.
// Every step is saved before the next, so a crash resumes without posting or remembering twice.
import { pathToFileURL } from "node:url";
import { ANALYSTS, buildReflectPrompt, type Role } from "../core/analysts.ts";
import { computeBoard, marketPoints } from "../core/points.ts";
import { seriesToSettle } from "../core/select.ts";
import { Store, toSettled, type SeriesRecord } from "../core/store.ts";
import type { Series } from "../core/worlds.ts";

export type SettleDeps = {
  fetchSeries(): Promise<Series[]>;
  store: Store;
  postResult(matchId: string, winner: string, score: string): Promise<string>;
  ask(prompt: string): Promise<string>;
  remember(role: Role, text: string): Promise<string>;
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

export async function runSettle(deps: SettleDeps): Promise<{ settled: string[] }> {
  const settled: string[] = [];
  for (const s of seriesToSettle(await deps.fetchSeries(), deps.store)) {
    let r = deps.store.get(s.matchId)!;
    const save = (next: SeriesRecord) => (deps.store.put(next), (r = next));
    const winsW = Math.max(s.winsA ?? 0, s.winsB ?? 0);
    const winsL = Math.min(s.winsA ?? 0, s.winsB ?? 0);
    const result = { winner: s.winner!, score: `${winsW}-${winsL}` };

    if (!r.result) save({ ...r, series: s, result: { ...result, resultDigest: await deps.postResult(s.matchId, result.winner, result.score) } });
    if (!r.points) save({ ...r, points: marketPoints(toSettled(r)) });
    if (!r.debate) save({ ...r, debate: (await deps.ask(debatePrompt(r, result))).trim() });
    for (const pick of r.picks) {
      if (r.lessons.some((l) => l.player === pick.player)) continue;
      const a = ANALYSTS.find((x) => x.player === pick.player)!;
      const lesson = (await deps.ask(buildReflectPrompt(a, s, pick, result, r.debate!))).trim();
      const text = `${lesson} (from ${s.block} ${s.teamA} vs ${s.teamB}; picked ${pick.winner}${pick.score ? ` ${pick.score}` : ""}, actual ${result.winner} ${result.score})`;
      const blobId = await deps.remember(a.role, text);
      save({ ...r, lessons: [...r.lessons, { player: pick.player, text, blobId }] });
    }
    save({ ...r, status: "settled" });
    deps.log(`${s.matchId} ${s.teamA} vs ${s.teamB}: ${result.winner} ${result.score}, ${r.lessons.length} lessons`);
    settled.push(s.matchId);
  }
  deps.store.writeBoard(computeBoard(deps.store.all().filter((x) => x.status === "settled").map(toSettled)));
  return { settled };
}

export async function realSettleDeps(store = new Store()): Promise<SettleDeps> {
  const { fetchSeries } = await import("../core/worlds.ts");
  const { memory } = await import("../core/memory.ts");
  const { askAnalyst } = await import("../core/llm.ts");
  const { postResult } = await import("../core/ledger.ts");
  return {
    fetchSeries,
    store,
    postResult,
    ask: async (prompt) => askAnalyst(prompt),
    remember: async (role, text) => {
      const ns = `kdace-analyst-${role}`;
      return (await memory(ns).rememberAndWait(text, ns, { timeoutMs: 90_000 })).blob_id;
    },
    log: (msg) => console.log(`[settle] ${msg}`),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { settled } = await runSettle(await realSettleDeps());
  console.log(`[settle] settled ${settled.length}`);
  process.exit(0);
}
