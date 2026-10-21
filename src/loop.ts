// PoC step 2: replay finished Worlds series through one analyst's full learning loop.
// recall lessons -> pick -> commit batch hash (Tatum) -> post result (Tatum) -> reflect -> remember (Walrus mainnet)
import { writeFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import { askClaude, askClaudeJson, fetchCompletedSeries, memory, refereeKeypair, sha256Hex, tatumClient } from "./lib.ts";

const ANALYST = "adc";
const NAMESPACE = process.env.POC_NAMESPACE ?? "kdace-poc-adc-run1";
const BELIEFS =
  "You are the ADC analyst on KDAce. Core belief: numbers over stories. You trust records, game-length tendencies and series scores. You bet carefully and only lean hard when the numbers are clear.";

type Pick = { winner: string; score: string; confidence: number; reasoning: string };

const sui = tatumClient();
const signer = refereeKeypair();
const mem = memory(NAMESPACE);
const pkg = process.env.KDACE_PACKAGE_ID!;
const cap = process.env.KDACE_RESOLVER_CAP!;

async function callLedger(fn: "commit_batch" | "post_result", args: (tx: Transaction) => any[]) {
  const tx = new Transaction();
  tx.moveCall({ target: `${pkg}::ledger::${fn}`, arguments: args(tx) });
  const res = await sui.signAndExecuteTransaction({ signer, transaction: tx, options: { showEffects: true } });
  await sui.waitForTransaction({ digest: res.digest });
  return res.digest;
}

const series = await fetchCompletedSeries();
const history: string[] = [];
const log: any[] = [];

for (const s of series) {
  const label = `${s.block} ${s.teamA} vs ${s.teamB} (Bo${s.bestOf}, ${s.startTime.slice(0, 10)})`;
  console.log(`\n=== ${label}`);

  // 1. Recall this analyst's own lessons.
  const recalled = await mem.recall({ query: `Predicting ${s.teamA} vs ${s.teamB}, a Bo${s.bestOf} at Worlds`, limit: 5, namespace: NAMESPACE });
  const lessons = recalled.results.map((r) => `- [${r.blob_id}] ${r.text}`).join("\n") || "(no lessons yet)";
  console.log(`recalled ${recalled.results.length} lesson(s)`);

  // 2. Pick, using only results that happened before this series.
  const pick = askClaudeJson<Pick>(`${BELIEFS}

Your past lessons (from your own memory):
${lessons}

Results so far this tournament:
${history.join("\n") || "(none yet)"}

Predict ${s.teamA} vs ${s.teamB}, best of ${s.bestOf}. Reply with only JSON:
{"winner":"<team code>","score":"<e.g. 3-1, winner first>","confidence":<0-100>,"reasoning":"<one or two sentences, cite a lesson id if you used one>"}`);
  console.log("pick:", pick);

  // 3. Commit the pick batch's fingerprint on chain through Tatum.
  const batch = JSON.stringify([{ player: `analyst-${ANALYST}`, market: s.matchId, winner: pick.winner, score: pick.score }]);
  const batchHash = sha256Hex(batch);
  const commitDigest = await callLedger("commit_batch", (tx) => [
    tx.object(cap),
    tx.pure.string(s.matchId),
    tx.pure.vector("u8", Buffer.from(batchHash, "hex")),
    tx.pure.u64(1),
    tx.object.clock(),
  ]);
  console.log("committed:", commitDigest);

  // 4. Post the real result through Tatum.
  const score = s.winner === s.teamA ? `${s.winsA}-${s.winsB}` : `${s.winsB}-${s.winsA}`;
  const resultDigest = await callLedger("post_result", (tx) => [
    tx.object(cap),
    tx.pure.string(s.matchId),
    tx.pure.string(s.winner),
    tx.pure.string(score),
    tx.object.clock(),
  ]);
  const correct = pick.winner === s.winner;
  console.log(`result: ${s.winner} ${score} -> analyst ${correct ? "RIGHT" : "WRONG"}${pick.score === score ? " (exact score)" : ""}`);

  // 5. Reflect through its own beliefs and remember the lesson on Walrus mainnet.
  const lesson = askClaude(`${BELIEFS}

You predicted ${pick.winner} ${pick.score} (confidence ${pick.confidence}) for ${s.teamA} vs ${s.teamB}. Your reasoning: "${pick.reasoning}".
Actual result: ${s.winner} won ${score}.
Write ONE short lesson (max 2 sentences) for your future self, explained through your numbers-first belief. Start with "ADC lesson:". No preamble.`);
  const written = await mem.rememberAndWait(`${lesson} (from ${label}; picked ${pick.winner} ${pick.score}, actual ${s.winner} ${score})`, NAMESPACE, { timeoutMs: 90_000 });
  console.log(`lesson: ${lesson}\nblob: https://walruscan.com/mainnet/blob/${written.blob_id}`);

  history.push(`${s.startTime.slice(0, 10)} ${s.teamA} vs ${s.teamB}: ${s.winner} won ${score}`);
  log.push({ series: s, pick, batch, batchHash, commitDigest, resultDigest, correct, lesson, lessonBlob: written.blob_id, recalledBlobs: recalled.results.map((r) => r.blob_id) });
  writeFileSync("poc-log.json", JSON.stringify(log, null, 2));
}

const right = log.filter((l) => l.correct).length;
console.log(`\nDone: ${right}/${log.length} correct. Log in poc-log.json`);
