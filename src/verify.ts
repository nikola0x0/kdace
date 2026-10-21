// PoC step 3: anyone can re-check the loop from chain + public data.
// Reads every ledger event through Tatum, re-hashes each published batch, and checks ordering.
import { readFileSync } from "node:fs";
import { sha256Hex, tatumClient } from "./lib.ts";

const sui = tatumClient();
const pkg = process.env.KDACE_PACKAGE_ID!;
const log: any[] = JSON.parse(readFileSync("poc-log.json", "utf8"));

// Tatum's gRPC gateway blocks ListEvents, so load each logged transaction by digest instead.
async function eventsOf(digest: string) {
  const tx = await sui.getTransaction({ digest, include: { events: true } });
  if (tx.$kind !== "Transaction") throw new Error(`transaction ${digest} failed`);
  return { events: tx.Transaction.events ?? [], timestampMs: (tx.Transaction as any).timestampMs };
}
console.log(`reading ${log.length * 2} ledger transactions via Tatum gRPC (${process.env.TATUM_SUI_GRPC})`);

let ok = 0;
for (const entry of log) {
  const market = entry.series.matchId;
  const commitTx = await eventsOf(entry.commitDigest);
  const resultTx = await eventsOf(entry.resultDigest);
  const commit: any = commitTx.events.find((e) => e.eventType === `${pkg}::ledger::BatchCommitted` && e.json?.market_id === market);
  const result: any = resultTx.events.find((e) => e.eventType === `${pkg}::ledger::ResultPosted` && e.json?.market_id === market);
  const rawHash = commit?.json?.batch_hash;
  const onchainHash = !rawHash ? "" : Array.isArray(rawHash) ? Buffer.from(rawHash).toString("hex") : Buffer.from(rawHash, "base64").toString("hex");
  const checks = {
    batchHashMatches: onchainHash === sha256Hex(entry.batch),
    committedBeforeResult: !!commit && !!result && Number(commit.json.committed_at_ms) < Number(result.json.posted_at_ms),
    resultMatchesOfficial: result?.json?.winner === entry.series.winner,
  };
  const pass = Object.values(checks).every(Boolean);
  if (pass) ok++;
  console.log(`${pass ? "PASS" : "FAIL"} ${entry.series.teamA} vs ${entry.series.teamB}`, checks);
  console.log(`   commit https://suiscan.xyz/testnet/tx/${entry.commitDigest}`);
  console.log(`   lesson https://walruscan.com/mainnet/blob/${entry.lessonBlob}  (used ${entry.recalledBlobs.length} earlier lesson(s))`);
}
console.log(`\n${ok}/${log.length} series verified.`);
console.log("Note: this PoC replays past series, so commits are checked against the posted result, not the real game start.");
