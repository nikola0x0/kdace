// Analyst LLM. For now the builder's Claude Code CLI; swap the body for a paid API before going public.
import { execFileSync } from "node:child_process";

export function askAnalyst(prompt: string): string {
  return execFileSync("claude", ["-p", "--output-format", "text"], { input: prompt, maxBuffer: 1 << 20 })
    .toString()
    .trim();
}

export function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in reply");
  return JSON.parse(match[0]) as T;
}
