// Tick: settle finished series, pick open ones, then commit and push data/ if anything changed. Run every 30 min by launchd.
import { execFileSync } from "node:child_process";
import { Store } from "../core/store.ts";
import { realPickDeps, runPick } from "./pick.ts";
import { realSettleDeps, runSettle } from "./settle.ts";

const store = new Store();
const started = new Date().toISOString();
const settled = await runSettle(await realSettleDeps(store));
const picked = await runPick(await realPickDeps(store));
console.log(`[tick] ${started}: settled ${settled.settled.length}, committed ${picked.committed.length}, missed ${picked.missed.length}`);

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });
if (git("status", "--porcelain", "data").trim()) {
  git("add", "data");
  git("commit", "-m", `data: tick ${started}`);
  git("push");
  console.log("[tick] data committed and pushed");
}
process.exit(0);
