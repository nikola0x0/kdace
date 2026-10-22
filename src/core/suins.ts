// A fan's default SuiNS name, cached on their fan row: refreshed at sign-in and at most daily otherwise.
// The lookup itself (mainnet, through Tatum) is injected so this stays dependency-free.
import type { FanDb } from "./fandb.ts";

export const SUINS_TTL_MS = 24 * 3600_000;

export async function refreshSuins(db: FanDb, address: string, lookup: (address: string) => Promise<string | null>, now: Date, force = false): Promise<string | null> {
  const fan = await db.getFan(address);
  const fresh = fan?.suinsCheckedAt && now.getTime() - Date.parse(fan.suinsCheckedAt) < SUINS_TTL_MS;
  if (fresh && !force) return fan!.suinsName;
  let name: string | null;
  try {
    name = await lookup(address);
  } catch {
    return fan?.suinsName ?? null; // keep the old name and retry on the next request
  }
  await db.setSuins(address, name, now.toISOString());
  return name;
}
