// The active season and what's next. Starting a new competition later is one entry here.
export type Season = { id: string; name: string; short: string; stages: string[]; next: string[] };

export const SEASON: Season = {
  id: "worlds-2026",
  name: "Worlds 2026",
  short: "Worlds",
  stages: ["Play-In", "Swiss", "Quarterfinals", "Semifinals", "Final"],
  next: ["LCK", "LPL", "LEC", "MSI"],
};

/** Which stage a schedule block belongs to ("Swiss Stage", "Quarterfinals" and so on → index into SEASON.stages). */
export function stageIndex(block: string | undefined): number {
  const b = (block ?? "").toLowerCase();
  if (b.includes("play")) return 0;
  if (b.includes("quarter")) return 2;
  if (b.includes("semi")) return 3;
  if (b.includes("final")) return 4;
  return 1;
}
