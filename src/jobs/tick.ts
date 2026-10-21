// Tick (launchd, every 30 min): pick first because it is time-critical, then settle, then commit and push data/.
// Each stage is isolated so one failure never skips the other, and one lock keeps manual runs from overlapping.
import { execFileSync } from "node:child_process";
import { withLock } from "../core/lock.ts";
import { Store } from "../core/store.ts";
import { realPickDeps, runPick } from "./pick.ts";
import { realSettleDeps, runSettle } from "./settle.ts";

const started = new Date().toISOString();
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" });

await withLock("data", async () => {
  const store = new Store();
  for (const [stage, run] of [
    ["pick", async () => console.log("[tick] pick", await runPick(await realPickDeps(store)))],
    ["settle", async () => console.log("[tick] settle", await runSettle(await realSettleDeps(store)))],
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
