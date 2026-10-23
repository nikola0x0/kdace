// Analyst LLM: Claude Sonnet 5.5 with adaptive thinking through the Anthropic API when ANTHROPIC_API_KEY is set,
// otherwise the builder's Claude Code CLI (local development only). The thinking comes back as a readable summary,
// which the pick job publishes and locks into the fingerprint alongside the reasoning.
import { execFileSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import "./env.ts"; // loads .env so ANTHROPIC_API_KEY is visible however this module is reached

export const ANALYST_MODEL = "claude-sonnet-5-5";

/** The reply text and the model's thinking summary ("" when the provider gives none). */
export type AnalystReply = { text: string; thinking: string };

type Provider = "anthropic" | "claude-cli";

export function analystProvider(env: Record<string, string | undefined> = process.env): Provider {
  if (env.ANALYST_PROVIDER === "anthropic" || env.ANALYST_PROVIDER === "claude-cli") return env.ANALYST_PROVIDER;
  return env.ANTHROPIC_API_KEY ? "anthropic" : "claude-cli";
}

type Reply = { stop_reason: string | null; content: { type: string; text?: string; thinking?: string }[] };

/** The reply's text. A refusal throws, so the caller retries once and then leaves that analyst out. */
export function replyText(message: Reply): string {
  return replyParts(message).text;
}

/** The reply's text and thinking summary. A refusal throws. */
export function replyParts(message: Reply): AnalystReply {
  if (message.stop_reason === "refusal") throw new Error("Model refused the request");
  const join = (type: string, key: "text" | "thinking", sep: string) => message.content.flatMap((b) => (b.type === type && b[key] ? [b[key]!] : [])).join(sep).trim();
  return { text: join("text", "text", ""), thinking: join("thinking", "thinking", "\n\n") };
}

let client: Anthropic | undefined;

/** Per-call limits, for callers with a deadline (the Vercel runner): one attempt, cut off after `timeoutMs`. */
export type AskOptions = { timeoutMs?: number };

export async function askAnalyst(prompt: string, opts: AskOptions = {}): Promise<string> {
  return (await askAnalystFull(prompt, "high", opts)).text;
}

/** One analyst turn with its thinking summary. On a policy decline the API re-runs it on a fallback model. */
export async function askAnalystFull(prompt: string, effort: "high" | "xhigh" = "high", opts: AskOptions = {}): Promise<AnalystReply> {
  if (analystProvider() === "claude-cli") {
    // A hung CLI call would block every later tick, so it is killed after 3 minutes.
    const text = execFileSync("claude", ["-p", "--output-format", "text"], { input: prompt, maxBuffer: 1 << 20, timeout: 180_000 }).toString().trim();
    return { text, thinking: "" };
  }
  client ??= new Anthropic({ timeout: 300_000 });
  const message = await client.beta.messages.create({
    model: ANALYST_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: prompt }],
  }, opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 0 } : undefined);
  return replyParts(message);
}

export { extractJson } from "./json.ts";
