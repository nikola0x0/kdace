// Verify job: re-checks every committed and settled series against Sui (read through Tatum), recomputes every market's
// AXP payouts from the published batches, and recomputes the leaderboard.
// Fan batches (committed under `<matchId>:fans` at lock) are checked the same way.
// Reads data/ by default; with KDACE_RECORDS_URL (e.g. https://kdace.xyz/api/records) it checks the live records instead.
import { chainOf } from "../core/chain.ts";
import { axpMatches, boardMatches, checkFans, checkFinalCall, checkRecord, checkTitleDay, checkVoid, startShift } from "../core/checks.ts";
import { readLedgerEvent } from "../core/ledger.ts";
import { recordsFromUrl } from "../core/records.ts";
import { Store, type RecordReader } from "../core/store.ts";
import { fetchSeries } from "../core/worlds.ts";

const recordsUrl = process.env.KDACE_RECORDS_URL;
const store: RecordReader = recordsUrl ? await recordsFromUrl(recordsUrl) : new Store();
console.log(`Records: ${recordsUrl ?? "data/"}`);
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
    // A settled series' AXP results are recomputed from its published batches (parimutuel per market).
    ...(r.status === "settled" ? { resultMatchesOfficial, axpRecomputes: axpMatches(r) } : {}),
    // A void series (no official result 48 h after the start, or cancelled): VOID on chain and every stake refunded.
    ...(r.status === "void" ? { ...checkVoid(r, result), axpRecomputes: axpMatches(r) } : {}),
  };
  if (fansCommitted(r)) {
    const fanCommit = await readLedgerEvent(r.fans!.commitDigest!, r.fans!.chain);
    Object.assign(relevant, checkFans(r, fanCommit, official));
  }
  // The analysts' final call (top-ups before lock under <matchId>:final), when one was committed.
  const final = r.finalCall?.status === "committed" ? r.finalCall : null;
  if (final) Object.assign(relevant, checkFinalCall(r, await readLedgerEvent(final.commitDigest!, chainOf(final)), official));
  const pass = Object.values(relevant).every(Boolean);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${r.series.block} ${r.series.teamA} vs ${r.series.teamB} [${r.status}]`, relevant);
  const shift = startShift(r, official);
  if (shift) console.log(`   note   ${shift}`);
  if (r.commitDigest) console.log(`   commit https://suiscan.xyz/${network}/tx/${r.commitDigest}`);
  if (fansCommitted(r)) console.log(`   fans   https://suiscan.xyz/${r.fans!.chain.network}/tx/${r.fans!.commitDigest} (${r.fans!.pickCount} fan picks)`);
  if (final) console.log(`   final  https://suiscan.xyz/${chainOf(final).network}/tx/${final.commitDigest} (${final.calls.filter((c) => c.add > 0).length} top-ups)`);
  if (r.result) console.log(`   result https://suiscan.xyz/${network}/tx/${r.result.resultDigest}`);
  for (const l of r.lessons) console.log(`   lesson https://walruscan.com/mainnet/blob/${l.blobId} (${l.player})`);
}

for (const day of store.titleDays().filter((d) => d.status === "committed")) {
  const checks = checkTitleDay(day, await readLedgerEvent(day.commitDigest!, chainOf(day)));
  const pass = Object.values(checks).every(Boolean);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} title calls ${day.date}`, checks);
  console.log(`   commit https://suiscan.xyz/${(chainOf(day)).network}/tx/${day.commitDigest}`);
}

const board = boardMatches(store);
if (!board) failures++;
console.log(`${board ? "PASS" : "FAIL"} leaderboard recomputes from the settled batches (analysts and fans)`);
console.log("Note: a second commit for the same match cannot be detected here (Tatum gRPC blocks event listing).");
console.log("Note: fan picks between lock and the fan commit (normally under a minute) rely on the database's timestamps; the commit itself is checked to land before the start.");
console.log(failures ? `\n${failures} check group(s) failed.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
