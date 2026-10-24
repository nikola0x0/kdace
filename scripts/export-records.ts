// Daily public snapshot (KDACE_STORE=supabase): writes every record from Supabase back into data/ (series, titles,
// board.json, fans.json, scout/) in the same file format, so the repo keeps the public record. Only files whose content
// changed are rewritten; nothing is deleted. Run by .github/workflows/snapshot.yml, which commits data/.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.   npx tsx scripts/export-records.ts [--dry-run]
import "../src/core/env.ts";
import { copyRecords } from "../src/core/recordsync.ts";
import { Store } from "../src/core/store.ts";
import { SupabaseStore, supabaseRestFromEnv } from "../src/core/supastore.ts";

const dryRun = process.argv.includes("--dry-run");
const out = await copyRecords(new SupabaseStore(supabaseRestFromEnv()), new Store("data"), { dryRun });
console.log(`${dryRun ? "Dry run" : "Exported"}: Supabase → data/`);
console.log(`  series records: ${out.series.inserted} new, ${out.series.updated} changed, ${out.series.same} unchanged${out.series.extra.length ? `; only in data/ (kept, check!): ${out.series.extra.join(", ")}` : ""}`);
console.log(`  title days:     ${out.titleDays.inserted} new, ${out.titleDays.updated} changed, ${out.titleDays.same} unchanged`);
console.log(`  documents:      ${out.docs.written.join(", ") || "unchanged"}; scout: ${out.scout.written.join(", ") || "unchanged"}`);
