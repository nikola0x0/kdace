// Creates the Referee's Ed25519 key, stores it in .env (git-ignored) and prints only its address.
import { appendFileSync, readFileSync } from "node:fs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

if (/^SUI_REFEREE_KEY=./m.test(readFileSync(".env", "utf8"))) {
  console.error("SUI_REFEREE_KEY already set in .env; refusing to overwrite.");
  process.exit(1);
}
const kp = new Ed25519Keypair();
appendFileSync(".env", `\n# Referee (mainnet commits and results)\nSUI_REFEREE_KEY=${kp.getSecretKey()}\n`);
console.log(`Referee address: ${kp.toSuiAddress()}`);
