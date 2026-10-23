// Trash talk: when the analysts split on a series, they roast each other's picks in a short comment thread before the
// game. It's flavour only: written after the picks are committed, never part of the fingerprint. Lumi is never roasted.
import type { AnalystPick, Role } from "./analysts.ts";
import { extractJson } from "./json.ts";
import type { SeriesRecord } from "./store.ts";

export type BanterComment = { by: Role; replyTo: number | null; text: string };
export type Banter = { comments: BanterComment[]; at: string };

/** Each analyst's on-screen handle and how they talk trash. */
export const HANDLES: Record<Role, { handle: string; style: string }> = {
  top: { handle: "Kairo", style: "cocky, blunt, thinks everything is decided by who wins the 1v1" },
  jungle: { handle: "Vyne", style: "hot-headed, fast-talking, everything is about tempo and who starts the first fight" },
  mid: { handle: "Nyx0", style: "cold and dry, condescending about other people's draft reads" },
  adc: { handle: "Raze", style: "clinical, roasts with numbers and win rates" },
  support: { handle: "Lumi", style: "warm and cute, teases gently, never mean" },
};

const roleOf = (player: string) => player.replace(/^analyst-/, "") as Role;

/** A committed series the analysts split on (2+ different winners) that has no thread yet. */
export const needsBanter = (r: SeriesRecord) => r.status === "committed" && !r.banter && new Set(r.picks.map((p) => p.winner)).size > 1;

export function buildBanterPrompt(r: SeriesRecord): string {
  const s = r.series;
  const line = (p: AnalystPick) => {
    const role = roleOf(p.player);
    return `- ${HANDLES[role].handle} (${role}, ${HANDLES[role].style}): picked ${p.winner} at ${p.winProbability}%. Their reasoning: "${p.reasoning}"`;
  };
  return `You write a short pre-game comment thread for KDAce, a LoL Worlds 2026 prediction board, where five AI analysts trash-talk each other's picks.
Match: ${s.teamA} vs ${s.teamB}, best of ${s.bestOf} (${s.block}).
The analysts and their picks:
${r.picks.map(line).join("\n")}

Write 4 to 7 comments. Analysts on opposite sides roast each other's picks and reasoning, and reply to each other. Rules:
- Roast the picks and the reasoning, never real players or teams' people personally. No slurs, nothing hateful, nothing about real-world identity. Playful esports banter, like a caster desk.
- Nobody ever roasts Lumi. Everyone is sweet and protective toward her, even when she picked the other side (at most a fond "Lumi, no..." or "we still love you"). Lumi can tease the others gently.
- Each comment is one or two short sentences, under 200 characters, in that analyst's voice. Use handles (Kairo, Vyne, Nyx0, Raze, Lumi), no @ signs, no hashtags, no emoji spam (at most one emoji per comment).
- Only analysts listed above may speak. "replyTo" is the 0-based index of an earlier comment it answers, or null.
Reply with only JSON:
{"comments":[{"by":"<top|jungle|mid|adc|support>","replyTo":<number or null>,"text":"<comment>"}]}`;
}

export function parseBanter(reply: string, r: SeriesRecord, now: Date): Banter {
  const speakers = new Set(r.picks.map((p) => roleOf(p.player)));
  const raw = extractJson<{ comments?: { by?: string; replyTo?: number | null; text?: string }[] }>(reply).comments ?? [];
  const comments: BanterComment[] = [];
  for (const c of raw.slice(0, 8)) {
    const by = c.by as Role;
    const text = String(c.text ?? "").trim();
    if (!speakers.has(by) || !text || text.length > 280) continue;
    const replyTo = Number.isInteger(c.replyTo) && (c.replyTo as number) >= 0 && (c.replyTo as number) < comments.length ? (c.replyTo as number) : null;
    comments.push({ by, replyTo, text });
  }
  if (comments.length < 2) throw new Error(`only ${comments.length} usable comments`);
  return { comments, at: now.toISOString() };
}

