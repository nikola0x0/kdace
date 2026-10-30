// The Graveyard: when a team is knocked out of Worlds, the analysts roast its run in one short thread, built from what
// they actually learned about that team (their own picks on it and the Walrus lessons they wrote after those series).
// Flavour only, like the trash talk: written once per team, never part of a fingerprint. Lumi is never roasted.
import type { Role } from "./analysts.ts";
import { HANDLES } from "./banter.ts";
import { extractJson } from "./json.ts";
import type { SeriesRecord } from "./store.ts";
import type { Series } from "./worlds.ts";

export type EulogyComment = {
  by: Role;
  replyTo: number | null;
  text: string;
  /** The Walrus lesson this roast comes from, when it leans on one. */
  lesson: { blobId: string; text: string } | null;
};

export type Eulogy = {
  team: string;
  /** The series that knocked the team out, and who did it. */
  out: { matchId: string; by: string; block: string; at: string };
  /** Main-stage series record at Worlds. */
  record: { w: number; l: number };
  comments: EulogyComment[];
  at: string;
};

/** Knocked-out team -> its thread. */
export type Graveyard = Record<string, Eulogy>;

const ROLES: Role[] = ["top", "jungle", "mid", "adc", "support"];
const roleOf = (player: string) => player.replace(/^analyst-/, "") as Role;
const isPlayIn = (block: string) => block.toLowerCase().includes("play");
const isSwiss = (block: string) => block.toLowerCase().includes("swiss");
const loserOf = (s: Series) => (s.winner === s.teamA ? s.teamB : s.teamA);

export type KnockOut = { team: string; out: Eulogy["out"]; record: Eulogy["record"] };

/**
 * Main-stage teams that are out, oldest exit first: a third Swiss loss, or any knockout loss. Play-In exits are left out
 * (the board wasn't taking picks yet, so the analysts have nothing of their own to roast them with).
 */
export function knockedOut(schedule: Series[]): KnockOut[] {
  const main = schedule.filter((s) => !isPlayIn(s.block) && s.state === "completed" && s.winner).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const rec: Record<string, { w: number; l: number }> = {};
  const swissLosses: Record<string, number> = {};
  const out = new Map<string, Eulogy["out"]>();
  for (const s of main) {
    const loser = loserOf(s);
    (rec[s.winner!] ??= { w: 0, l: 0 }).w++;
    (rec[loser] ??= { w: 0, l: 0 }).l++;
    const gone = isSwiss(s.block) ? (swissLosses[loser] = (swissLosses[loser] ?? 0) + 1) >= 3 : true;
    if (gone && !out.has(loser)) out.set(loser, { matchId: s.matchId, by: s.winner!, block: s.block, at: s.startTime });
  }
  return [...out].map(([team, o]) => ({ team, out: o, record: rec[team] }));
}

/** True once the analysts have written their lessons on the series that knocked the team out (or never picked it). */
export function lessonsIn(k: KnockOut, records: SeriesRecord[]): boolean {
  const r = records.find((x) => x.series.matchId === k.out.matchId);
  if (!r || r.status === "missed" || !r.picks.length) return true;
  return r.status === "settled" && !!r.debate && r.picks.every((p) => r.lessons.find((l) => l.player === p.player)?.blobId);
}

/** Teams that are out, have their lessons in, and have no thread yet. */
export const needsEulogy = (schedule: Series[], records: SeriesRecord[], graveyard: Graveyard) =>
  knockedOut(schedule).filter((k) => !graveyard[k.team] && lessonsIn(k, records));

/** Per analyst: their calls on the team's series and the lessons they wrote after them, labelled L1, L2, ... */
export function memoryOf(team: string, records: SeriesRecord[]) {
  const games = records
    .filter((r) => r.status === "settled" && r.result && [r.series.teamA, r.series.teamB].includes(team) && !isPlayIn(r.series.block))
    .sort((a, b) => a.series.startTime.localeCompare(b.series.startTime));
  return Object.fromEntries(
    ROLES.map((role) => {
      const calls: string[] = [];
      const lessons: { id: string; blobId: string; text: string }[] = [];
      for (const r of games) {
        const s = r.series;
        const p = r.picks.find((x) => roleOf(x.player) === role);
        const won = r.result!.winner;
        if (p) calls.push(`${s.startTime.slice(5, 10)} ${s.teamA} vs ${s.teamB} (${won} won ${r.result!.score}): picked ${p.winner} at ${p.winProbability}%, ${p.winner === won ? "right" : "WRONG"}`);
        const l = r.lessons.find((x) => roleOf(x.player) === role && x.blobId);
        if (l) lessons.push({ id: `L${lessons.length + 1}`, blobId: l.blobId, text: l.text.split(" (from ")[0] });
      }
      return [role, { calls, lessons }];
    }),
  ) as Record<Role, { calls: string[]; lessons: { id: string; blobId: string; text: string }[] }>;
}

export function buildEulogyPrompt(k: KnockOut, records: SeriesRecord[]): string {
  const mem = memoryOf(k.team, records);
  const desk = ROLES.map((role) => {
    const m = mem[role];
    return `### ${HANDLES[role].handle} (${role}, ${HANDLES[role].style})
Their calls on ${k.team}:
${m.calls.map((c) => `- ${c}`).join("\n") || "- (none)"}
Lessons they wrote after those series:
${m.lessons.map((l) => `- [${l.id}] ${l.text}`).join("\n") || "- (none)"}`;
  }).join("\n\n");
  return `You write a short farewell roast for KDAce, a LoL Worlds 2026 prediction board, where five AI analysts react when a team is knocked out.
${k.team} is out of Worlds 2026: ${k.record.w}-${k.record.l} in the main stage, eliminated by ${k.out.by} (${k.out.block}).

What each analyst called and what they learned about ${k.team}:

${desk}

Write exactly one comment per analyst (5 comments), in the order that makes the best thread. Rules:
- Every roast must come from that analyst's own calls and lessons above: the numbers, the drafts, the moments they wrote down. Cite the lesson it comes from in "lesson" (e.g. "L1"), or null if it comes only from their calls. Don't invent stats that aren't above.
- If an analyst backed ${k.team} and lost money on it, they roast themselves too. Owning the bad call is funnier than pretending.
- Roast the team's run, results and drafts, never real players or staff personally. No slurs, nothing hateful, nothing about real-world identity. Playful caster-desk banter.
- Nobody ever roasts Lumi. Lumi gives ${k.team} a warm, cute send-off (she can still tease gently).
- One or two short sentences each, under 200 characters, in that analyst's voice. Use handles (Kairo, Vyne, Nyx0, Raze, Lumi), no @ signs, no hashtags, at most one emoji per comment.
- "replyTo" is the 0-based index of an earlier comment it answers, or null.
Reply with only JSON:
{"comments":[{"by":"<top|jungle|mid|adc|support>","replyTo":<number or null>,"lesson":"<L1, L2, ... or null>","text":"<comment>"}]}`;
}

export function parseEulogy(reply: string, k: KnockOut, records: SeriesRecord[], now: Date): Eulogy {
  const mem = memoryOf(k.team, records);
  const raw = extractJson<{ comments?: { by?: string; replyTo?: number | null; lesson?: string | null; text?: string }[] }>(reply).comments ?? [];
  const comments: EulogyComment[] = [];
  const spoke = new Set<Role>();
  for (const c of raw.slice(0, 8)) {
    const by = c.by as Role;
    const text = String(c.text ?? "").trim();
    if (!ROLES.includes(by) || spoke.has(by) || !text || text.length > 280) continue;
    const replyTo = Number.isInteger(c.replyTo) && (c.replyTo as number) >= 0 && (c.replyTo as number) < comments.length ? (c.replyTo as number) : null;
    const l = mem[by].lessons.find((x) => x.id === String(c.lesson ?? "").trim().toUpperCase());
    comments.push({ by, replyTo, text, lesson: l ? { blobId: l.blobId, text: l.text } : null });
    spoke.add(by);
  }
  if (comments.length < 3) throw new Error(`only ${comments.length} usable comments`);
  return { team: k.team, out: k.out, record: k.record, comments, at: now.toISOString() };
}
