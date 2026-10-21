// Walrus Memory (mainnet) client per namespace.
import { MemWal } from "@mysten-incubation/memwal";
import { env } from "./env.ts";

export function memory(namespace: string) {
  return MemWal.create({
    key: env("MEMWAL_PRIVATE_KEY"),
    accountId: env("MEMWAL_ACCOUNT_ID"),
    serverUrl: process.env.MEMWAL_SERVER_URL,
    namespace,
  });
}
