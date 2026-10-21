import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withLock } from "../src/core/lock.ts";

const dir = () => mkdtempSync(join(tmpdir(), "kdace-"));

describe("withLock", () => {
  it("refuses a second run while the first holds the lock", async () => {
    const d = dir();
    await withLock(d, async () => {
      await expect(withLock(d, async () => "inner")).rejects.toThrow(/already running/);
    });
  });
  it("releases the lock afterwards, even when the job throws", async () => {
    const d = dir();
    await expect(withLock(d, async () => { throw new Error("job failed"); })).rejects.toThrow("job failed");
    expect(await withLock(d, async () => "ok")).toBe("ok");
  });
  it("reclaims a stale lock left by a crashed run", async () => {
    const d = dir();
    writeFileSync(join(d, ".lock"), "12345");
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000);
    utimesSync(join(d, ".lock"), threeHoursAgo, threeHoursAgo);
    expect(await withLock(d, async () => "ok")).toBe("ok");
  });
});
