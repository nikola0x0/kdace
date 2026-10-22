// Analyst LLM: Claude Haiku 5.5 through the Anthropic API when ANTHROPIC_API_KEY is set,
// otherwise the builder's Claude Code CLI (local development only).
import { execFileSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";

export const ANALYST_MODEL = "claude-haiku-5-5";

type Provider = "anthropic" | "claude-cli";

export function analystProvider(env: Record<string, string | undefined> = process.env): Provider {
  if (env.ANALYST_PROVIDER === "anthropic" || env.ANALYST_PROVIDER === "claude-cli") return env.ANALYST_PROVIDER;
  return env.ANTHROPIC_API_KEY ? "anthropic" : "claude-cli";
}

/** The reply's text. A refusal throws, so the caller retries once and then leaves that analyst out. */
export function replyText(message: Pick<Anthropic.Message, "stop_reason" | "content">): string {
  if (message.stop_reason === "refusal") throw new Error("Model refused the request");
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

let client: Anthropic | undefined;

export async function askAnalyst(prompt: string): Promise<string> {
  if (analystProvider() === "claude-cli") {
    // A hung CLI call would block every later tick, so it is killed after 3 minutes.
    return execFileSync("claude", ["-p", "--output-format", "text"], { input: prompt, maxBuffer: 1 << 20, timeout: 180_000 })
      .toString()
      .trim();
  }
  client ??= new Anthropic({ timeout: 180_000 });
  const message = await client.messages.create({
    model: ANALYST_MODEL,
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });
  return replyText(message);
}

export { extractJson } from "./json.ts";
