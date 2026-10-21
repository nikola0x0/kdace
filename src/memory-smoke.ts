// PoC step 1: prove a Walrus Memory mainnet write + recall for one analyst namespace.
import "dotenv/config";
import { MemWal } from "@mysten-incubation/memwal";

const namespace = "kdace-poc-adc";
const memwal = MemWal.create({
  key: process.env.MEMWAL_PRIVATE_KEY!,
  accountId: process.env.MEMWAL_ACCOUNT_ID!,
  serverUrl: process.env.MEMWAL_SERVER_URL,
  namespace,
});

console.log("health:", await memwal.health());
const lesson = "ADC analyst lesson: I trusted late-game win rate alone and ignored that the opponent ends games before 25 minutes. Check average game length before trusting scaling.";
const written = await memwal.rememberAndWait(lesson, namespace, { timeoutMs: 60_000 });
console.log("remembered:", written);
console.log(`walruscan: https://walruscan.com/mainnet/blob/${written.blob_id}`);

const hits = await memwal.recall({ query: "should I trust late game scaling stats?", limit: 5, namespace });
console.log("recall:", JSON.stringify(hits, null, 2));
