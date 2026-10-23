// Tick (every 30 min, or dispatched early by the lock route): mirror fan commits from Supabase, then the fast settle
// (results on Sui, AXP, board, voids) and the fans' settled AXP back to Supabase, then the analysts' final calls and the
// picks (time-critical), then the daily title picks and banter, then the slow settle (debate and Walrus lessons), then
// publish data/pending.json for the dispatcher and commit and push data/. Each stage is isolated so one failure never
// skips the others (except: settle waits for a successful fan mirror, so AXP is never settled without the fans), and one
// lock keeps manual runs from overlapping.
//
// With KDACE_STORE=supabase the records live in Supabase instead: the tick then runs the same staged runner as the
// Vercel route (src/jobs/runner.ts), one stage per call under the shared runner lock, until there is nothing left to
// do, and commits nothing to git (the daily snapshot does). Running it next to the Vercel cron is safe.
import { execFileSync } from "node:child_process";
import "../core/env.ts"; // loads .env before Supabase settings are read
import { pendingRecords } from "../core/dispatch.ts";
import { fanDbFromEnv } from "../core/fandb.ts";
import { withLock } from "../core/lock.ts";
import { Store } from "../core/store.ts";
import { storeKind } from "../core/supastore.ts";
import { fetchSeries } from "../core/worlds.ts";
import { mirrorFans, syncFanAxp } from "./fans.ts";
import { realFinalCallDeps, runFinalCall } from "./finalcall.ts";
import { realPickDeps, runPick } from "./pick.ts";
import { realSettleDeps, runSettleFast, runSettleSlow } from "./settle.ts";
import { realTitleDeps, runTitles } from "./titles.ts";
import { realBanterDeps, runBanter } from "./banter.ts";

const started = new Date().toISOString();
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

if (storeKind() === "supabase") {
  const { runUntilIdle } = await import("./runner.ts");
  const out = await runUntilIdle({ holder: `github:${process.env.GITHUB_RUN_ID ?? process.pid}`, maxMs: 20 * 60_000 });
  console.log(`[tick] supabase runner: ${out.runs} call(s), stopped: ${out.stopped}`);
  process.exit(0);
}

await withLock("data", async () => {
  const store = new Store();
  const db = fanDbFromEnv();
  let fansOk = true;
  const fans = async () => {
    if (!db) return console.log("[tick] fans: Supabase not configured, skipping");
    fansOk = false;
    const { mirrored } = await mirrorFans(store, db, fetchSeries, (m) => console.log(`[tick] fans ${m}`));
    console.log("[tick] fans mirrored", mirrored);
    fansOk = true;
  };
  for (const [stage, run] of [
    ["fans", fans],
    // Results first: posting a result and settling AXP is quick, and frees AXP for the picks and final calls below.
    ["settle", async () => (fansOk ? console.log("[tick] settle", await runSettleFast(await realSettleDeps(store))) : console.log("[tick] settle skipped: fan commits could not be mirrored"))],
    // Each fan's settled net goes back to Supabase, where the API checks stakes against available AXP.
    ["axp", async () => (db ? console.log("[tick] fan axp", await syncFanAxp(store, db, new Date())) : undefined)],
    // Top-ups shortly before lock, on the side each analyst picked. Before the picks: it's bounded (the five analysts
    // answer in parallel) and its window is minutes wide, while picking several new series can take a while.
    ["final", async () => console.log("[tick] final call", await runFinalCall(await realFinalCallDeps(store)))],
    ["pick", async () => console.log("[tick] pick", await runPick(await realPickDeps(store)))],
    // Who wins Worlds: once per UTC day, after the time-critical series picks.
    ["titles", async () => console.log("[tick] titles", await runTitles(await realTitleDeps(store)))],
    // Trash talk on series the analysts split on (flavour only, never fingerprinted).
    ["banter", async () => console.log("[tick] banter", await runBanter(await realBanterDeps(store)))],
    // The slow part of settling: the debate and one Walrus lesson per analyst.
    ["lessons", async () => console.log("[tick] lessons", await runSettleSlow(await realSettleDeps(store)))],
    ["pending", async () => store.writePending(pendingRecords(store.all(), (await import("../core/ledger.ts")).currentChain()))],
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
