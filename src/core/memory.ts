// Walrus Memory (mainnet) client per namespace.
import { MemWal } from "@mysten-incubation/memwal";
import { env } from "./env.ts";

/**
 * Each analyst can write with its own delegate key (MEMWAL_KEY_TOP, MEMWAL_KEY_JUNGLE, ...), so every lesson is signed
 * by that analyst's identity. Until a role has its own key, the shared MEMWAL_PRIVATE_KEY is used.
 */
export function memoryKey(namespace: string, vars: Record<string, string | undefined> = process.env): string {
  const role = namespace.match(/^kdace-analyst-(\w+)$/)?.[1];
  return (role && vars[`MEMWAL_KEY_${role.toUpperCase()}`]) || env("MEMWAL_PRIVATE_KEY");
}

export function memory(namespace: string) {
  return MemWal.create({
    key: memoryKey(namespace),
    accountId: env("MEMWAL_ACCOUNT_ID"),
    serverUrl: process.env.MEMWAL_SERVER_URL,
    namespace,
  });
}
