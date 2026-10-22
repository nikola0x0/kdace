// One-shot switch to mainnet: publishes the ledger with the mainnet Referee key, checks a commit would work,
// then points .env and GitHub Actions at the new package. Records already committed on testnet stay verifiable there.
// Usage: npx tsx scripts/go-mainnet.ts [--dry-run]
import { execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { chainOf, tatumGrpcHost } from "../src/core/chain.ts";
import { env } from "../src/core/env.ts";
import { Store } from "../src/core/store.ts";
import { tatumClient } from "../src/core/sui.ts";

const dryRun = process.argv.includes("--dry-run");
const MIN_BALANCE = 200_000_000n; // 0.2 SUI: publish costs ~0.02, each commit or result ~0.003
const die = (msg: string) => (console.error(msg), process.exit(1));

if (process.env.SUI_NETWORK === "mainnet") die("Already on mainnet (SUI_NETWORK=mainnet in .env).");

const mainnetKey = env("SUI_REFEREE_KEY_MAINNET");
const { scheme, secretKey } = decodeSuiPrivateKey(mainnetKey);
if (scheme !== "ED25519") die(`SUI_REFEREE_KEY_MAINNET must be Ed25519, got ${scheme}`);
const referee = Ed25519Keypair.fromSecretKey(secretKey);
const address = referee.toSuiAddress();
const sui = tatumClient("mainnet");

// 1. A series committed on testnet must also get its result on testnet, so switch only between series.
const pending = new Store().all().filter((r) => (r.status === "committing" || r.status === "committed") && chainOf(r).network !== "mainnet");
if (pending.length && !dryRun) die(`Wait until these testnet series settle:\n${pending.map((r) => `  ${r.series.teamA} vs ${r.series.teamB} (${r.series.startTime})`).join("\n")}`);

if (pending.length) console.log(`Note: ${pending.length} testnet series still pending; the real run will wait for them.`);

// 2. Gas.
const { balance } = await sui.getBalance({ owner: address });
console.log(`Referee ${address}: ${Number(balance.balance) / 1e9} SUI`);
if (BigInt(balance.balance) < MIN_BALANCE) die(`Send at least ${Number(MIN_BALANCE) / 1e9} SUI (0.5 recommended) to ${address} on mainnet, then rerun.`);

// 3. Build for mainnet.
const out = execFileSync("sui", ["move", "build", "--path", "move", "--dump-bytecode-as-base64", "-e", "mainnet"], { stdio: ["ignore", "pipe", "inherit"] }).toString();
const { modules, dependencies } = JSON.parse(out.slice(out.indexOf("{"))) as { modules: string[]; dependencies: string[] };
console.log(`Built ${modules.length} module(s).`);
if (dryRun) {
  console.log("Dry run: stopping before publish.");
  process.exit(0);
}

// 4. Publish; the ResolverCap goes to the sender (the Referee), and so does the UpgradeCap.
const tx = new Transaction();
tx.transferObjects([tx.publish({ modules, dependencies })], address);
const res = await sui.signAndExecuteTransaction({ signer: referee, transaction: tx, include: { effects: true, objectTypes: true } });
if (res.$kind !== "Transaction") die(`Publish failed: ${JSON.stringify(res.FailedTransaction?.effects?.status)}`);
const published = res.Transaction!;
const created = published.effects!.changedObjects.filter((o) => o.idOperation === "Created");
const packageId = created.find((o) => o.outputState === "PackageWrite")?.objectId;
const cap = created.find((o) => published.objectTypes![o.objectId]?.endsWith("::ledger::ResolverCap"))?.objectId;
const upgradeCap = created.find((o) => published.objectTypes![o.objectId] === "0x2::package::UpgradeCap")?.objectId;
if (!packageId || !cap) die(`Published (${published.digest}) but could not find the package or ResolverCap; check Suiscan.`);
console.log(`Published ${packageId} (tx ${published.digest}), ResolverCap ${cap}`);
await sui.waitForTransaction({ digest: published.digest }).catch(() => {});

// 5. Smoke test without writing: simulate a commit with the new cap.
const smoke = new Transaction();
smoke.setSender(address);
smoke.moveCall({
  target: `${packageId}::ledger::commit_batch`,
  arguments: [smoke.object(cap!), smoke.pure.string("smoke-test"), smoke.pure.vector("u8", new Array(32).fill(0)), smoke.pure.u64(5), smoke.object.clock()],
});
const sim = await sui.simulateTransaction({ transaction: smoke, include: { effects: true } });
if (sim.$kind !== "Transaction") die(`Simulated commit failed: ${JSON.stringify(sim.FailedTransaction?.effects?.status)}`);
console.log("Simulated commit_batch: OK");

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

// 7. Record the publish next to the testnet one, like the Sui CLI would.
appendFileSync(
  "move/Published.toml",
  `\n[published.mainnet]\nchain-id = "35834a8a"\npublished-at = "${packageId}"\noriginal-id = "${packageId}"\nversion = 1\n` +
    `toolchain-version = "${execFileSync("sui", ["--version"]).toString().split(" ")[1]?.split("-")[0]}"\n` +
    `build-config = { flavor = "sui", edition = "2024" }\nupgrade-capability = "${upgradeCap}"\n`,
);

// 8. GitHub Actions: the next cloud tick runs on mainnet.
const gh = (args: string[], input?: string) => execFileSync("gh", args, { input, stdio: [input ? "pipe" : "ignore", "ignore", "inherit"] });
gh(["variable", "set", "SUI_NETWORK", "--body", "mainnet"]);
gh(["variable", "set", "TATUM_SUI_GRPC", "--body", tatumGrpcHost("mainnet")]);
gh(["variable", "set", "KDACE_PACKAGE_ID", "--body", packageId!]);
gh(["variable", "set", "KDACE_RESOLVER_CAP", "--body", cap!]);
gh(["secret", "set", "SUI_REFEREE_KEY"], mainnetKey);
console.log("GitHub Actions variables and SUI_REFEREE_KEY secret updated.");

console.log(`\nDone. Commit move/Published.toml and push. https://suiscan.xyz/mainnet/tx/${published.digest}`);
process.exit(0);
