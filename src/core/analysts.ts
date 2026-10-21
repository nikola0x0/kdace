// The five role analysts: fixed beliefs, pick prompts, pick validation and reflection prompts.
import { extractJson } from "./llm.ts";
import type { Series } from "./worlds.ts";

export type Role = "top" | "jungle" | "mid" | "adc" | "support";

export type Analyst = { role: Role; player: `analyst-${Role}`; name: string; belief: string; voice: string };

export type Lesson = { blobId: string; text: string; createdAt: string };

export type AnalystPick = {
  player: string;
  winner: string;
  score: string | null;
  winProbability: number;
  reasoning: string;
  usedLessons: Lesson[];
  pickedAt: string;
};

const analyst = (role: Role, name: string, belief: string, voice: string): Analyst => ({ role, player: `analyst-${role}`, name, belief, voice });

export const ANALYSTS: Analyst[] = [
  analyst("top", "Top", "Individual skill wins series. Trust the stronger players over team stats, and distrust whatever the crowd is hyped about.", "Stubborn and blunt."),
  analyst("jungle", "Jungle", "The early game decides everything: first objectives, tempo and who controls the map in the first 15 minutes.", "Fast-talking, always about tempo."),
  analyst("mid", "Mid", "Draft and champion pools decide series, especially under Fearless Draft, together with the form of the star players.", "Confident, thinks in drafts."),
  analyst("adc", "ADC", "Numbers over stories: records, head-to-heads, game length tendencies and series scores.", "Careful, only leans hard when the numbers are clear."),
  analyst("support", "Support", "The team decides it: chemistry, morale, roster changes, coaching and the mood around a team.", "Warm, reads people."),
];

const VALID_SCORES: Record<1 | 3 | 5, string[]> = { 1: [], 3: ["2-0", "2-1"], 5: ["3-0", "3-1", "3-2"] };

const fixedBeliefs = (a: Analyst) =>
  `You are the ${a.name} analyst on KDAce, a LoL Worlds 2026 prediction board. Your voice: ${a.voice}
Core belief: ${a.belief}
Your beliefs are fixed; lessons refine how you apply them, never replace them.`;

export function buildPickPrompt(a: Analyst, s: Series, lessons: Lesson[], history: string[]): string {
  const scoreRule = s.bestOf === 1 ? '"score" must be null (best of 1)' : `"score" is winner-first, one of ${VALID_SCORES[s.bestOf].join(", ")}`;
  return `${fixedBeliefs(a)}

Your past lessons (from your own memory):
${lessons.map((l) => `- [${l.blobId}] ${l.text}`).join("\n") || "(no lessons yet)"}

Results so far this tournament:
${history.join("\n") || "(none yet)"}

Predict ${s.teamA} vs ${s.teamB}, best of ${s.bestOf} (${s.block}). Pick blind: you do not know what anyone else picked.
Reply with only JSON:
{"winner":"<${s.teamA} or ${s.teamB}>","score":<see rule>,"winProbability":<50-100, your chance the winner wins>,"reasoning":"<one or two sentences in your voice>","usedLessonIds":["<ids of lessons you relied on>"]}
Rule: ${scoreRule}.`;
}

export function parsePick(reply: string, a: Analyst, s: Series, lessons: Lesson[], now: Date): AnalystPick {
  const raw = extractJson<{ winner?: string; score?: string | null; winProbability?: number; reasoning?: string; usedLessonIds?: string[] }>(reply);
  if (raw.winner !== s.teamA && raw.winner !== s.teamB) throw new Error(`winner ${raw.winner} is not in ${s.teamA} vs ${s.teamB}`);
  const score = raw.score ?? null;
  if (s.bestOf === 1 ? score !== null : !VALID_SCORES[s.bestOf].includes(String(score))) throw new Error(`score ${score} is invalid for Bo${s.bestOf}`);
  const p = Number(raw.winProbability);
  if (!(p >= 50 && p <= 100)) throw new Error(`winProbability ${raw.winProbability} is outside 50-100`);
  const ids = new Set(raw.usedLessonIds ?? []);
  return {
    player: a.player,
    winner: raw.winner,
    score,
    winProbability: p,
    reasoning: String(raw.reasoning ?? ""),
    usedLessons: lessons.filter((l) => ids.has(l.blobId)),
    pickedAt: now.toISOString(),
  };
}

export function buildReflectPrompt(a: Analyst, s: Series, pick: AnalystPick, result: { winner: string; score: string }, debate: string): string {
  return `${fixedBeliefs(a)}

You predicted ${pick.winner}${pick.score ? ` ${pick.score}` : ""} (confidence ${pick.winProbability}) for ${s.teamA} vs ${s.teamB}, best of ${s.bestOf}.
Your reasoning: "${pick.reasoning}"
Actual result: ${result.winner} won ${result.score}.

The post-match debate between the five analysts:
${debate}

Write ONE short lesson (max 2 sentences) for your future self, explained through your core belief. You may borrow an idea from the debate, but filter it through your own belief. Start with "${a.name} lesson:". No preamble.`;
}
