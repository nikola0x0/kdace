// The analysts as characters: look and voice only. Their prediction beliefs live in src/core/analysts.ts.
import type { Role } from "../../src/core/analysts.ts";

export type Persona = { role: Role; player: `analyst-${Role}`; name: string; title: string; personality: string; color: string; meta: string[] };

export const PERSONAS: Persona[] = [
  { role: "top", player: "analyst-top", name: "Top", title: "The Duelist", color: "#ff8a3d", meta: ["Rumble", "Aatrox", "Fiora"],
    personality: "Cocky and blunt. Lives for solo kills and thinks series are won on the island by whoever wins the 1v1." },
  { role: "jungle", player: "analyst-jungle", name: "Jungle", title: "The Commander", color: "#ff4d5e", meta: ["Jarvan IV", "Vi", "Lee Sin"],
    personality: "Hot-headed and always first in. Whoever starts the first skirmish wins, and the map belongs to the bold." },
  { role: "mid", player: "analyst-mid", name: "Mid", title: "The Strategist", color: "#9b7bff", meta: ["Viktor", "Syndra", "Ahri"],
    personality: "Cold and patient. Never panics, reads the draft and waits for the long game to pay off." },
  { role: "adc", player: "analyst-adc", name: "ADC", title: "The Sharpshooter", color: "#3fd9c4", meta: ["Lucian", "Aphelios"],
    personality: "Clinical. Trusts hard numbers, lane priority and the team that farms better. Only leans hard when the data is clear." },
  { role: "support", player: "analyst-support", name: "Support", title: "The Protector", color: "#7ee08a", meta: ["Lulu"],
    personality: "Warm and reads people. The team that protects its star and stays together wins." },
];

export const persona = (player: string) => PERSONAS.find((p) => p.player === player || p.role === player);
