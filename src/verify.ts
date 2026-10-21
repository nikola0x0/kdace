// PoC step 3: anyone can re-check the loop from chain + public data.
// Reads every ledger event through Tatum, re-hashes each published batch, and checks ordering.
import { readFileSync } from "node:fs";
import { sha256Hex, tatumClient } from "./lib.ts";

const sui = tatumClient();
const pkg = process.env.KDACE_PACKAGE_ID!;
const log: any[] = JSON.parse(readFileSync("poc-log.json", "utf8"));

const events: any[] = [];
let cursor: any = null;
do {
  const page = await sui.queryEvents({ query: { MoveEventModule: { package: pkg, module: "ledger" } }, cursor, order: "ascending" });
  events.push(...page.data);
  cursor = page.hasNextPage ? page.nextCursor : null;
} while (cursor);
console.log(`read ${events.length} ledger events via Tatum (${process.env.TATUM_SUI_RPC})`);

let ok = 0;
for (const entry of log) {
  const market = entry.series.matchId;
  const commits = events.filter((e) => e.type.endsWith("::BatchCommitted") && e.parsedJson.market_id === market);
  const results = events.filter((e) => e.type.endsWith("::ResultPosted") && e.parsedJson.market_id === market);
  const commit = commits.at(-1);
  const result = results.at(-1);
  const onchainHash = commit ? Buffer.from(commit.parsedJson.batch_hash).toString("hex") : "";
  const checks = {
    batchHashMatches: onchainHash === sha256Hex(entry.batch),
    committedBeforeResult: !!commit && !!result && Number(commit.parsedJson.committed_at_ms) < Number(result.parsedJson.posted_at_ms),
    resultMatchesOfficial: result?.parsedJson.winner === entry.series.winner,
  };
  const pass = Object.values(checks).every(Boolean);
  if (pass) ok++;
  console.log(`${pass ? "PASS" : "FAIL"} ${entry.series.teamA} vs ${entry.series.teamB}`, checks);
  console.log(`   commit https://suiscan.xyz/testnet/tx/${entry.commitDigest}`);
  console.log(`   lesson https://walruscan.com/mainnet/blob/${entry.lessonBlob}  (used ${entry.recalledBlobs.length} earlier lesson(s))`);
}
console.log(`\n${ok}/${log.length} series verified.`);
console.log("Note: this PoC replays past series, so commits are checked against the posted result, not the real game start.");
