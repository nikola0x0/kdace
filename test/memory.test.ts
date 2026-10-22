import { describe, expect, it } from "vitest";
import { memoryKey } from "../src/core/memory.ts";

describe("memoryKey", () => {
  it("uses the analyst's own delegate key when it has one", () => {
    expect(memoryKey("kdace-analyst-mid", { MEMWAL_KEY_MID: "mid-key", MEMWAL_PRIVATE_KEY: "shared" })).toBe("mid-key");
  });
  it("falls back to the shared key", () => {
    process.env.MEMWAL_PRIVATE_KEY ??= "shared-test";
    expect(memoryKey("kdace-analyst-top", {})).toBe(process.env.MEMWAL_PRIVATE_KEY);
  });
});
