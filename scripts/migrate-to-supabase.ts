// Copies data/ (series records, title days, board, fan names, Scout) into the Supabase record tables, idempotently:
// only rows that differ are written, nothing is deleted. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env).
//   npx tsx scripts/migrate-to-supabase.ts --dry-run   counts what a copy would write, writes nothing
//   npx tsx scripts/migrate-to-supabase.ts             copies
//   npx tsx scripts/migrate-to-supabase.ts --compare   diffs Supabase against data/; exits 1 unless identical
// Run the copy while nothing else writes records (GitHub tick schedule paused), then --compare.
import "../src/core/env.ts";
import { compareRecords, copyRecords } from "../src/core/recordsync.ts";
import { Store } from "../src/core/store.ts";
import { SupabaseStore, supabaseRestFromEnv } from "../src/core/supastore.ts";

const args = process.argv.slice(2);
const file = new Store("data");
const supabase = new SupabaseStore(supabaseRestFromEnv());

if (args.includes("--compare")) {
  const out = await compareRecords(file, supabase);
  for (const d of out.differences) console.log(`  ${d}`);
  console.log(out.identical ? `Supabase matches data/ (${out.byteExact ? "byte-exact" : "same content; key order differs"}).` : `Supabase differs from data/ (${out.differences.length} difference(s)).`);
  process.exit(out.identical ? 0 : 1);
}

const dryRun = args.includes("--dry-run");
const out = await copyRecords(file, supabase, { dryRun });
console.log(`${dryRun ? "Dry run (nothing written)" : "Copied"}: data/ → Supabase`);
console.log(`  series records: ${file.all().length} in data/; ${out.series.inserted} new, ${out.series.updated} changed, ${out.series.same} already identical${out.series.extra.length ? `; only in Supabase (kept): ${out.series.extra.join(", ")}` : ""}`);
console.log(`  title days:     ${out.titleDays.inserted} new, ${out.titleDays.updated} changed, ${out.titleDays.same} identical${out.titleDays.extra.length ? `; only in Supabase: ${out.titleDays.extra.join(", ")}` : ""}`);
console.log(`  documents:      ${out.docs.written.length ? `write ${out.docs.written.join(", ")}` : "nothing to write"}${out.docs.same.length ? ` (identical: ${out.docs.same.join(", ")})` : ""}`);
console.log(`  scout:          ${out.scout.written.length ? `write ${out.scout.written.join(", ")}` : "nothing to write"}${out.scout.same.length ? ` (identical: ${out.scout.same.join(", ")})` : ""}`);
if (!dryRun) console.log("Next: npx tsx scripts/migrate-to-supabase.ts --compare");
