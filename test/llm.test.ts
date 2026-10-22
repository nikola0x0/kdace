import { describe, expect, it } from "vitest";
import { analystProvider, replyText } from "../src/core/llm.ts";

describe("analystProvider", () => {
  it("uses the Anthropic API when a key is set", () => expect(analystProvider({ ANTHROPIC_API_KEY: "k" })).toBe("anthropic"));
  it("falls back to the Claude CLI without a key", () => expect(analystProvider({})).toBe("claude-cli"));
  it("honours an explicit override", () => expect(analystProvider({ ANTHROPIC_API_KEY: "k", ANALYST_PROVIDER: "claude-cli" })).toBe("claude-cli"));
});

describe("replyText", () => {
  it("joins the text blocks and ignores thinking blocks", () => {
    const msg = { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"winner":' }, { type: "text", text: '"T1"}' }] };
    expect(replyText(msg as any)).toBe('{"winner":"T1"}');
  });
  it("throws on a refusal so the caller retries or skips the analyst", () => {
    expect(() => replyText({ stop_reason: "refusal", content: [] } as any)).toThrow(/refus/);
  });
});
