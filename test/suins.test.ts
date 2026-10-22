import { describe, expect, it } from "vitest";
import { refreshSuins } from "../src/core/suins.ts";
import { MemoryFanDb } from "./helpers/memory-fandb.ts";

const A = "0x" + "a".repeat(64);
const now = new Date("2026-10-23T12:00:00Z");

async function fan(checkedAt: string | null, name: string | null = null) {
  const db = new MemoryFanDb();
  await db.ensureFan(A);
  if (checkedAt) await db.setSuins(A, name, checkedAt);
  return db;
}

describe("refreshSuins", () => {
  it("looks the name up and caches it on the fan row", async () => {
    const db = await fan(null);
    expect(await refreshSuins(db, A, async () => "nikola.sui", now)).toBe("nikola.sui");
    expect(await db.getFan(A)).toMatchObject({ suinsName: "nikola.sui", suinsCheckedAt: now.toISOString() });
  });
  it("uses the cache for a day", async () => {
    const db = await fan("2026-10-23T00:00:00.000Z", "old.sui");
    let calls = 0;
    expect(await refreshSuins(db, A, async () => (calls++, "new.sui"), now)).toBe("old.sui");
    expect(calls).toBe(0);
    expect(await refreshSuins(db, A, async () => "new.sui", new Date("2026-10-24T00:00:01Z"))).toBe("new.sui");
  });
  it("refreshes at sign-in even when cached", async () => {
    const db = await fan("2026-10-23T11:00:00.000Z", "old.sui");
    expect(await refreshSuins(db, A, async () => null, now, true)).toBeNull();
    expect((await db.getFan(A))!.suinsName).toBeNull();
  });
  it("keeps the cached name when the lookup fails", async () => {
    const db = await fan("2026-10-20T00:00:00.000Z", "old.sui");
    expect(await refreshSuins(db, A, async () => { throw new Error("tatum down"); }, now)).toBe("old.sui");
    expect((await db.getFan(A))!.suinsCheckedAt).toBe("2026-10-20T00:00:00.000Z");
  });
});
