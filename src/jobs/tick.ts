// Tick (every 30 min): pick first because it is time-critical, then the daily title picks, then mirror fan commits from Supabase, then settle, then
// write the fans' settled AXP back to Supabase, then commit and push data/. Each stage is isolated so one failure never
// skips the others (except: settle waits for a successful fan mirror, so AXP is never settled without the fans), and one
// lock keeps manual runs from overlapping.
import { execFileSync } from "node:child_process";
import "../core/env.ts"; // loads .env before Supabase settings are read
import { fanDbFromEnv } from "../core/fandb.ts";
import { withLock } from "../core/lock.ts";
import { Store } from "../core/store.ts";
import { fetchSeries } from "../core/worlds.ts";
import { fanAddresses, mirrorFanCommits, syncFanAxp } from "./fans.ts";
import { realPickDeps, runPick } from "./pick.ts";
import { realSettleDeps, runSettle } from "./settle.ts";
import { realTitleDeps, runTitles } from "./titles.ts";

const started = new Date().toISOString();
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

await withLock("data", async () => {
  const store = new Store();
  const db = fanDbFromEnv();
  let fansOk = true;
  const fans = async () => {
    if (!db) return console.log("[tick] fans: Supabase not configured, skipping");
    fansOk = false;
    await db.ping(); // also keeps the free Supabase project from pausing
    const changed = mirrorFanCommits(store, await db.listCommits(), await fetchSeries(), (m) => console.log(`[tick] fans ${m}`));
    console.log("[tick] fans mirrored", changed);
    const names = await db.fanNames(fanAddresses(store));
    if (JSON.stringify(names) !== JSON.stringify(store.readFanNames())) store.writeFanNames(names);
    fansOk = true;
  };
  for (const [stage, run] of [
    ["pick", async () => console.log("[tick] pick", await runPick(await realPickDeps(store)))],
    // Who wins Worlds: once per UTC day, after the time-critical series picks.
    ["titles", async () => console.log("[tick] titles", await runTitles(await realTitleDeps(store)))],
    ["fans", fans],
    ["settle", async () => (fansOk ? console.log("[tick] settle", await runSettle(await realSettleDeps(store))) : console.log("[tick] settle skipped: fan commits could not be mirrored"))],
    // Each fan's settled net goes back to Supabase, where the API checks stakes against available AXP.
    ["axp", async () => (db ? console.log("[tick] fan axp", await syncFanAxp(store, db, new Date())) : undefined)],
  ] as const) {
    try {
      await run();
    } catch (e) {
      console.error(`[tick] ${stage} failed: ${(e as Error).message}`);
    }
  }

  if (!git("status", "--porcelain", "data").trim()) return;
  git("add", "data");
  git("commit", "-m", `data: tick ${started}`, "--", "data"); // only data/, never whatever else is staged
  try {
    git("pull", "--rebase", "--autostash");
    git("push");
    console.log("[tick] data committed and pushed");
  } catch (e) {
    console.error(`[tick] push failed, data stays committed locally: ${(e as Error).message}`);
  }
});
process.exit(0);
