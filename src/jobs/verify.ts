// Verify job: re-checks every committed and settled series against Sui (read through Tatum) and recomputes the board.
import { boardMatches, checkRecord } from "../core/checks.ts";
import { readLedgerEvent } from "../core/ledger.ts";
import { Store } from "../core/store.ts";

const network = process.env.SUI_NETWORK ?? "mainnet";
const store = new Store();
let failures = 0;

for (const r of store.all().filter((x) => x.status !== "missed").sort((a, b) => a.series.startTime.localeCompare(b.series.startTime))) {
  const commit = r.commitDigest ? await readLedgerEvent(r.commitDigest) : null;
  const result = r.result ? await readLedgerEvent(r.result.resultDigest) : null;
  const checks = checkRecord(r, commit, result);
  const relevant = r.status === "settled" ? checks : { hashMatches: checks.hashMatches, committedBeforeStart: checks.committedBeforeStart, lessonsPredatePicks: checks.lessonsPredatePicks };
  const pass = Object.values(relevant).every(Boolean);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${r.series.block} ${r.series.teamA} vs ${r.series.teamB} [${r.status}]`, relevant);
  console.log(`   commit https://suiscan.xyz/${network}/tx/${r.commitDigest}`);
  if (r.result) console.log(`   result https://suiscan.xyz/${network}/tx/${r.result.resultDigest}`);
  for (const l of r.lessons) console.log(`   lesson https://walruscan.com/mainnet/blob/${l.blobId} (${l.player})`);
}

const board = boardMatches(store);
if (!board) failures++;
console.log(`${board ? "PASS" : "FAIL"} board recomputes from settled records`);
console.log(failures ? `\n${failures} check group(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
