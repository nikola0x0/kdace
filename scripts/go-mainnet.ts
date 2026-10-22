// One-shot switch to mainnet: publishes the ledger with the mainnet Referee key, checks a commit would work,
// points .env and GitHub Actions at the new package, then re-commits every not-yet-started testnet batch on mainnet
// (same picks, same fingerprint, still before the game). Settled testnet records stay verifiable on testnet.
// Usage: npx tsx scripts/go-mainnet.ts --test   publish + one real smoke commit read back through Tatum; switches nothing
//        npx tsx scripts/go-mainnet.ts          the switch (reuses the tested package)   [--dry-run to check first]
// Rerun after a failure: it only finishes moving pending batches.
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { chainOf, tatumGrpcHost } from "../src/core/chain.ts";
import { withLock } from "../src/core/lock.ts";
import { isLocked } from "../src/core/select.ts";
import { env } from "../src/core/env.ts";
import { Store } from "../src/core/store.ts";
import { tatumClient } from "../src/core/sui.ts";

const dryRun = process.argv.includes("--dry-run");
const testRun = process.argv.includes("--test");
const MIN_BALANCE = 200_000_000n; // 0.2 SUI: publish costs ~0.02, each commit or result ~0.003
const die = (msg: string) => (console.error(msg), process.exit(1));

if (process.env.SUI_NETWORK === "mainnet") {
  await movePending();
  process.exit(0);
}

const mainnetKey = env("SUI_REFEREE_KEY_MAINNET");
const { scheme, secretKey } = decodeSuiPrivateKey(mainnetKey);
if (scheme !== "ED25519") die(`SUI_REFEREE_KEY_MAINNET must be Ed25519, got ${scheme}`);
const referee = Ed25519Keypair.fromSecretKey(secretKey);
const address = referee.toSuiAddress();
const sui = tatumClient("mainnet");

// 1. A series already under way must get its result on testnet, where it was committed, so wait for it to settle.
const testnetCommitted = new Store().all().filter((r) => r.status === "committed" && chainOf(r).network !== "mainnet");
const underWay = testnetCommitted.filter((r) => isLocked(r.series.startTime, new Date()));
if (underWay.length && !testRun) die(`Wait until these testnet series settle:\n${underWay.map((r) => `  ${r.series.teamA} vs ${r.series.teamB} (${r.series.startTime})`).join("\n")}`);
console.log(`${testnetCommitted.length} testnet batch(es) will be re-committed on mainnet before their games.`);

// 2. Gas.
const { balance } = await sui.getBalance({ owner: address });
console.log(`Referee ${address}: ${Number(balance.balance) / 1e9} SUI`);
if (BigInt(balance.balance) < MIN_BALANCE) die(`Send at least ${Number(MIN_BALANCE) / 1e9} SUI (0.5 recommended) to ${address} on mainnet, then rerun.`);

/** Sets NAME=value lines in an env file, adding the ones that are missing. */
function setEnv(file: string, entries: Record<string, string>) {
  let text = readFileSync(file, "utf8");
  for (const [name, value] of Object.entries(entries))
    text = new RegExp(`^${name}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`;
  writeFileSync(file, text);
}

// 3-4. Reuse the package from a successful --test run; otherwise build and publish (ResolverCap and UpgradeCap go to the Referee).
let packageId = process.env.KDACE_PACKAGE_ID_MAINNET;
let cap = process.env.KDACE_RESOLVER_CAP_MAINNET;
if (packageId && cap) console.log(`Using the mainnet package from the test run: ${packageId}`);
else {
  const out = execFileSync("sui", ["move", "build", "--path", "move", "--dump-bytecode-as-base64", "-e", "mainnet"], { stdio: ["ignore", "pipe", "inherit"] }).toString();
  const { modules, dependencies } = JSON.parse(out.slice(out.indexOf("{"))) as { modules: string[]; dependencies: string[] };
  console.log(`Built ${modules.length} module(s).`);
  if (dryRun) {
    console.log("Dry run: stopping before publish.");
    process.exit(0);
  }
  const tx = new Transaction();
  tx.transferObjects([tx.publish({ modules, dependencies })], address);
  const res = await sui.signAndExecuteTransaction({ signer: referee, transaction: tx, include: { effects: true, objectTypes: true } });
  if (res.$kind !== "Transaction") die(`Publish failed: ${JSON.stringify(res.FailedTransaction?.effects?.status)}`);
  const published = res.Transaction!;
  const created = published.effects!.changedObjects.filter((o) => o.idOperation === "Created");
  packageId = created.find((o) => o.outputState === "PackageWrite")?.objectId;
  cap = created.find((o) => published.objectTypes![o.objectId]?.endsWith("::ledger::ResolverCap"))?.objectId;
  const upgradeCap = created.find((o) => published.objectTypes![o.objectId] === "0x2::package::UpgradeCap")?.objectId;
  if (!packageId || !cap) die(`Published (${published.digest}) but could not find the package or ResolverCap; check Suiscan.`);
  console.log(`Published ${packageId} (https://suiscan.xyz/mainnet/tx/${published.digest}), ResolverCap ${cap}`);
  await sui.waitForTransaction({ digest: published.digest }).catch(() => {});
  // Saved straight away, so a later failure never publishes a second package.
  setEnv(".env", { KDACE_PACKAGE_ID_MAINNET: packageId!, KDACE_RESOLVER_CAP_MAINNET: cap! });
  // Recorded next to the testnet publish, like the Sui CLI would.
  appendFileSync(
    "move/Published.toml",
    `\n[published.mainnet]\nchain-id = "35834a8a"\npublished-at = "${packageId}"\noriginal-id = "${packageId}"\nversion = 1\n` +
      `toolchain-version = "${execFileSync("sui", ["--version"]).toString().split(" ")[1]?.split("-")[0]}"\n` +
      `build-config = { flavor = "sui", edition = "2024" }\nupgrade-capability = "${upgradeCap}"\n`,
  );
}

// 5. Smoke test. --test makes one real commit and reads it back like verify does; the switch only simulates one.
const smoke = new Transaction();
smoke.moveCall({
  target: `${packageId}::ledger::commit_batch`,
  arguments: [smoke.object(cap!), smoke.pure.string("smoke-test"), smoke.pure.vector("u8", new Array(32).fill(7)), smoke.pure.u64(5), smoke.object.clock()],
});
if (testRun) {
  const res = await sui.signAndExecuteTransaction({ signer: referee, transaction: smoke, include: { effects: true } });
  if (res.$kind !== "Transaction") die(`Smoke commit failed: ${JSON.stringify(res.FailedTransaction?.effects?.status)}`);
  await sui.waitForTransaction({ digest: res.Transaction!.digest }).catch(() => {});
  const { readLedgerEvent } = await import("../src/core/ledger.ts");
  const event = await readLedgerEvent(res.Transaction!.digest, { network: "mainnet", packageId: packageId! });
  const ok = event?.type === "BatchCommitted" && event.json.market_id === "smoke-test";
  console.log(`Smoke commit https://suiscan.xyz/mainnet/tx/${res.Transaction!.digest}: ${ok ? "read back OK" : "NOT read back"}`, ok ? "" : JSON.stringify(event));
  console.log(ok ? "\nMainnet test passed. Nothing was switched; run without --test to go live (it reuses this package)." : "\nMainnet test failed; nothing was switched.");
  process.exit(ok ? 0 : 1);
}
smoke.setSender(address);
const sim = await sui.simulateTransaction({ transaction: smoke, include: { effects: true } });
if (sim.$kind !== "Transaction") die(`Simulated commit failed: ${JSON.stringify(sim.FailedTransaction?.effects?.status)}`);
console.log("Simulated commit_batch: OK");
if (dryRun) {
  console.log("Dry run: stopping before the switch.");
  process.exit(0);
}

// 6. Point .env at mainnet (backup first); the testnet key is kept as SUI_REFEREE_KEY_TESTNET.
copyFileSync(".env", ".env.pre-mainnet");
let dotenv = readFileSync(".env", "utf8");
const set = (name: string, value: string) => {
  dotenv = new RegExp(`^${name}=.*$`, "m").test(dotenv) ? dotenv.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`) : `${dotenv.trimEnd()}\n${name}=${value}\n`;
};
set("SUI_REFEREE_KEY_TESTNET", env("SUI_REFEREE_KEY"));
set("SUI_REFEREE_KEY", mainnetKey);
set("SUI_NETWORK", "mainnet");
set("TATUM_SUI_GRPC", tatumGrpcHost("mainnet"));
set("KDACE_PACKAGE_ID", packageId!);
set("KDACE_RESOLVER_CAP", cap!);
writeFileSync(".env", dotenv);
console.log(".env updated (backup in .env.pre-mainnet).");

// 8. GitHub Actions: the next cloud tick runs on mainnet.
const gh = (args: string[], input?: string) => execFileSync("gh", args, { input, stdio: [input ? "pipe" : "ignore", "ignore", "inherit"] });
gh(["variable", "set", "SUI_NETWORK", "--body", "mainnet"]);
gh(["variable", "set", "TATUM_SUI_GRPC", "--body", tatumGrpcHost("mainnet")]);
gh(["variable", "set", "KDACE_PACKAGE_ID", "--body", packageId!]);
gh(["variable", "set", "KDACE_RESOLVER_CAP", "--body", cap!]);
gh(["secret", "set", "SUI_REFEREE_KEY"], mainnetKey);
console.log("GitHub Actions variables and SUI_REFEREE_KEY secret updated.");

// 8b. Vercel and web/.env.local: the fan lock route commits from Vercel, so it must move to mainnet too.
const live = { SUI_NETWORK: "mainnet", NEXT_PUBLIC_SUI_NETWORK: "mainnet", TATUM_SUI_GRPC: tatumGrpcHost("mainnet"), KDACE_PACKAGE_ID: packageId!, KDACE_RESOLVER_CAP: cap!, SUI_REFEREE_KEY: mainnetKey };
for (const [name, value] of Object.entries(live)) for (const target of ["production", "development"]) {
  try { execFileSync("vercel", ["env", "rm", name, target, "--yes"], { stdio: "ignore" }); } catch {}
  execFileSync("vercel", ["env", "add", name, target, ...(name === "SUI_REFEREE_KEY" && target === "production" ? ["--sensitive"] : [])], { input: value, stdio: ["pipe", "ignore", "inherit"] });
}
if (existsSync("web/.env.local")) {
  let local = readFileSync("web/.env.local", "utf8");
  for (const [name, value] of Object.entries(live)) local = new RegExp(`^${name}=.*$`, "m").test(local) ? local.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`) : `${local.trimEnd()}\n${name}=${value}\n`;
  writeFileSync("web/.env.local", local);
}
console.log("Vercel env and web/.env.local updated (the push below redeploys the site).");

// 9. The ledger module reads the live network from process.env, which now has to match the new .env.
Object.assign(process.env, { SUI_NETWORK: "mainnet", TATUM_SUI_GRPC: tatumGrpcHost("mainnet"), KDACE_PACKAGE_ID: packageId, KDACE_RESOLVER_CAP: cap, SUI_REFEREE_KEY: mainnetKey });
await movePending();
process.exit(0);

/** Re-commits each testnet batch whose game hasn't locked yet on mainnet, then pushes data/ so the cloud tick sees it. */
async function movePending() {
  const { commitBatch, currentChain } = await import("../src/core/ledger.ts");
  const chain = currentChain();
  const moved = await withLock("data", async () => {
    const store = new Store();
    const out: string[] = [];
    for (const r of store.all().filter((x) => x.status === "committed" && chainOf(x).network !== "mainnet")) {
      if (isLocked(r.series.startTime, new Date())) {
        console.log(`  ${r.series.teamA} vs ${r.series.teamB} has started; it settles on testnet.`);
        continue;
      }
      const count = (JSON.parse(r.batch!) as { entries: unknown[] }).entries.length;
      const digest = await commitBatch(r.series.matchId, r.batchHash!, count);
      store.put({ ...r, chain, commitDigest: digest, testnetCommitDigest: r.commitDigest! });
      console.log(`  ${r.series.teamA} vs ${r.series.teamB}: re-committed on mainnet (${digest})`);
      out.push(r.series.matchId);
    }
    return out;
  });
  const git = (...args: string[]) => execFileSync("git", args, { stdio: "inherit" });
  git("add", "data", "move/Published.toml", "move/Move.lock");
  if (execFileSync("git", ["diff", "--cached", "--name-only"]).toString().trim()) {
    git("commit", "-q", "-m", `Switch the ledger to mainnet; re-commit ${moved.length} pending batch(es)`);
    git("pull", "-q", "--rebase", "--autostash");
    git("push", "-q");
  }
  console.log(`\nDone: ${moved.length} batch(es) moved to mainnet and pushed.`);
}
