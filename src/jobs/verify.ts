// Verify job: re-checks every committed and settled series against Sui (read through Tatum) and recomputes the board.
// Fan batches (committed under `<matchId>:fans` at lock) are checked the same way.
import { chainOf } from "../core/chain.ts";
import { boardMatches, checkFans, checkRecord } from "../core/checks.ts";
import { readLedgerEvent } from "../core/ledger.ts";
import { Store } from "../core/store.ts";
import { fetchSeries } from "../core/worlds.ts";

const store = new Store();
let failures = 0;
const officialById = new Map((await fetchSeries()).map((s) => [s.matchId, s]));
const fansCommitted = (r: { fans?: { status: string } }) => r.fans?.status === "committed";

for (const r of store.all().filter((x) => x.status !== "missed" || fansCommitted(x)).sort((a, b) => a.series.startTime.localeCompare(b.series.startTime))) {
  // Each record is read on the network and package it was committed on (testnet before the mainnet switch).
  const chain = chainOf(r);
  const network = chain.network;
  const official = officialById.get(r.series.matchId);
  const commit = r.commitDigest ? await readLedgerEvent(r.commitDigest, chain) : null;
  const result = r.result ? await readLedgerEvent(r.result.resultDigest, chain) : null;
  const { resultMatchesOfficial, ...analystChecks } = checkRecord(r, commit, result, official);
  const relevant: Record<string, boolean> = {
    // A series the analysts missed has no analyst batch; only its fan batch and result are checked.
    ...(r.batch ? analystChecks : {}),
    ...(r.status === "settled" ? { resultMatchesOfficial } : {}),
  };
  if (fansCommitted(r)) {
    const fanCommit = await readLedgerEvent(r.fans!.commitDigest!, r.fans!.chain);
    Object.assign(relevant, checkFans(r, fanCommit, official));
  }
  const pass = Object.values(relevant).every(Boolean);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${r.series.block} ${r.series.teamA} vs ${r.series.teamB} [${r.status}]`, relevant);
  if (r.commitDigest) console.log(`   commit https://suiscan.xyz/${network}/tx/${r.commitDigest}`);
  if (fansCommitted(r)) console.log(`   fans   https://suiscan.xyz/${r.fans!.chain.network}/tx/${r.fans!.commitDigest} (${r.fans!.pickCount} fan picks)`);
  if (r.result) console.log(`   result https://suiscan.xyz/${network}/tx/${r.result.resultDigest}`);
  for (const l of r.lessons) console.log(`   lesson https://walruscan.com/mainnet/blob/${l.blobId} (${l.player})`);
}

const board = boardMatches(store);
if (!board) failures++;
console.log(`${board ? "PASS" : "FAIL"} board recomputes from settled records (analysts and fans)`);
console.log("Note: a second commit for the same match cannot be detected here (Tatum gRPC blocks event listing).");
console.log("Note: fan picks between lock and the fan commit (normally under a minute) rely on the database's timestamps; the commit itself is checked to land before the start.");
console.log(failures ? `\n${failures} check group(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
