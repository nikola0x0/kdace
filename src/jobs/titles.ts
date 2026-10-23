// Title job (a tick stage): once per UTC day while Worlds is on, each analyst names who wins it all; the day's calls
// are fingerprinted and committed on Sui under "title:<date>". A crash between recording and committing re-submits
// the same hash on the next run; a day is never re-picked.
import { ANALYSTS } from "../core/analysts.ts";
import { batchHash, canonicalBatch } from "../core/batch.ts";
import type { Chain } from "../core/chain.ts";
import type { TeamAggregate } from "../core/scout.ts";
import type { RecordStore } from "../core/store.ts";
import { aliveTeams, buildTitlePrompt, fieldLines, parseTitlePick, titleEntries, titleMarketId, tournamentOver, utcDate, type TitleDay, type TitlePick } from "../core/titles.ts";
import type { Series } from "../core/worlds.ts";

export type TitleDeps = {
  fetchSeries(): Promise<Series[]>;
  store: RecordStore;
  ask(prompt: string): Promise<string>;
  commit(marketId: string, hash: string, count: number): Promise<string>;
  chain: Chain;
  teams(): Record<string, TeamAggregate>;
  history(): string[];
  now(): Date;
  log(msg: string): void;
};

const MIN_ANALYSTS = 3;

/** Options for one run. The default is the tick's (analysts one after another); the Vercel runner asks them at once. */
export type TitleOptions = { parallel?: boolean };

export async function runTitles(deps: TitleDeps, opts: TitleOptions = {}): Promise<{ date: string; status: string }> {
  const date = utcDate(deps.now());
  const existing = await deps.store.getTitleDay(date);
  if (existing?.status === "committed") return { date, status: "already picked" };
  if (existing) return { date, status: await commitDay(deps, existing) };

  const series = await deps.fetchSeries();
  const alive = aliveTeams(series);
  if (tournamentOver(series) || alive.length < 2) return { date, status: "tournament over" };
  const field = fieldLines(alive, deps.teams());
  const history = deps.history();
  const one = async (a: (typeof ANALYSTS)[number]): Promise<TitlePick | null> => {
    const prompt = buildTitlePrompt(a, alive, field, history);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return parseTitlePick(await deps.ask(prompt), a, alive, deps.now());
      } catch (e) {
        deps.log(`${date} ${a.player} attempt ${attempt} invalid: ${(e as Error).message}`);
      }
    }
    return null;
  };
  // Either way the picks keep the analysts' order.
  const answers: (TitlePick | null)[] = [];
  if (opts.parallel) answers.push(...(await Promise.all(ANALYSTS.map(one))));
  else for (const a of ANALYSTS) answers.push(await one(a));
  const picks = answers.filter((p): p is TitlePick => p !== null);
  if (picks.length < MIN_ANALYSTS) return { date, status: `only ${picks.length} valid picks, retrying next run` };
  const batch = canonicalBatch(titleMarketId(date), titleEntries(picks));
  const day: TitleDay = { date, status: "committing", picks, batch, batchHash: batchHash(batch), commitDigest: null };
  await deps.store.putTitleDay(day); // recorded before the chain call, so a crash resumes with the same hash
  return { date, status: await commitDay(deps, day) };
}

async function commitDay(deps: TitleDeps, day: TitleDay): Promise<string> {
  const commitDigest = await deps.commit(titleMarketId(day.date), day.batchHash, day.picks.length);
  await deps.store.putTitleDay({ ...day, status: "committed", commitDigest, chain: deps.chain });
  deps.log(`${day.date}: committed ${day.picks.length} title picks (${commitDigest})`);
  return "committed";
}

export async function realTitleDeps(store: RecordStore): Promise<TitleDeps> {
  const { askAnalyst } = await import("../core/llm.ts");
  const { commitBatch, currentChain } = await import("../core/ledger.ts");
  const { fanDbFromEnv, withRefereeLock } = await import("../core/fandb.ts");

  const { fetchSeries } = await import("../core/worlds.ts");
  const { historyLines } = await import("./pick.ts");
  const scout = await store.readScout();
  const history = historyLines(await store.all());
  return {
    fetchSeries,
    store,
    ask: (prompt) => askAnalyst(prompt),
    commit: (id, hash, count) => withRefereeLock(fanDbFromEnv(), "tick", () => commitBatch(id, hash, count), { waitMs: 5 * 60_000, proceedIfDbDown: true }),
    chain: currentChain(),
    teams: () => scout?.teams ?? {},
    history: () => history,
    now: () => new Date(),
    log: (msg) => console.log(`[titles] ${msg}`),
  };
}
