// Title job (a tick stage): once per UTC day while Worlds is on, each analyst names who wins it all; the day's calls
// are fingerprinted and committed on Sui under "title:<date>". A crash between recording and committing re-submits
// the same hash on the next run; a day is never re-picked.
import { ANALYSTS } from "../core/analysts.ts";
import { batchHash, canonicalBatch } from "../core/batch.ts";
import type { Chain } from "../core/chain.ts";
import type { TeamAggregate } from "../core/scout.ts";
import type { Store } from "../core/store.ts";
import { aliveTeams, buildTitlePrompt, fieldLines, parseTitlePick, titleEntries, titleMarketId, tournamentOver, utcDate, type TitleDay, type TitlePick } from "../core/titles.ts";
import type { Series } from "../core/worlds.ts";

export type TitleDeps = {
  fetchSeries(): Promise<Series[]>;
  store: Store;
  ask(prompt: string): Promise<string>;
  commit(marketId: string, hash: string, count: number): Promise<string>;
  chain: Chain;
  teams(): Record<string, TeamAggregate>;
  history(): string[];
  now(): Date;
  log(msg: string): void;
};

const MIN_ANALYSTS = 3;

export async function runTitles(deps: TitleDeps): Promise<{ date: string; status: string }> {
  const date = utcDate(deps.now());
  const existing = deps.store.getTitleDay(date);
  if (existing?.status === "committed") return { date, status: "already picked" };
  if (existing) return { date, status: await commitDay(deps, existing) };

  const series = await deps.fetchSeries();
  const alive = aliveTeams(series);
  if (tournamentOver(series) || alive.length < 2) return { date, status: "tournament over" };
  const field = fieldLines(alive, deps.teams());
  const history = deps.history();
  const picks: TitlePick[] = [];
  for (const a of ANALYSTS) {
    const prompt = buildTitlePrompt(a, alive, field, history);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        picks.push(parseTitlePick(await deps.ask(prompt), a, alive, deps.now()));
        break;
      } catch (e) {
        deps.log(`${date} ${a.player} attempt ${attempt} invalid: ${(e as Error).message}`);
      }
    }
  }
  if (picks.length < MIN_ANALYSTS) return { date, status: `only ${picks.length} valid picks, retrying next run` };
  const batch = canonicalBatch(titleMarketId(date), titleEntries(picks));
  const day: TitleDay = { date, status: "committing", picks, batch, batchHash: batchHash(batch), commitDigest: null };
  deps.store.putTitleDay(day); // recorded before the chain call, so a crash resumes with the same hash
  return { date, status: await commitDay(deps, day) };
}

async function commitDay(deps: TitleDeps, day: TitleDay): Promise<string> {
  const commitDigest = await deps.commit(titleMarketId(day.date), day.batchHash, day.picks.length);
  deps.store.putTitleDay({ ...day, status: "committed", commitDigest, chain: deps.chain });
  deps.log(`${day.date}: committed ${day.picks.length} title picks (${commitDigest})`);
  return "committed";
}

export async function realTitleDeps(store: Store): Promise<TitleDeps> {
  const { askAnalyst } = await import("../core/llm.ts");
  const { commitBatch, currentChain } = await import("../core/ledger.ts");
  const { fanDbFromEnv, withRefereeLock } = await import("../core/fandb.ts");
  const { loadScout } = await import("../core/scoutstore.ts");
  const { fetchSeries } = await import("../core/worlds.ts");
  const { historyLines } = await import("./pick.ts");
  const scout = loadScout();
  return {
    fetchSeries,
    store,
    ask: (prompt) => askAnalyst(prompt),
    commit: (id, hash, count) => withRefereeLock(fanDbFromEnv(), "tick", () => commitBatch(id, hash, count), { waitMs: 5 * 60_000, proceedIfDbDown: true }),
    chain: currentChain(),
    teams: () => scout?.teams ?? {},
    history: () => historyLines(store),
    now: () => new Date(),
    log: (msg) => console.log(`[titles] ${msg}`),
  };
}
