// Approximate brand colours for Worlds 2026 teams, used to tint match cards. Unknown teams fall back to neutral grey.
const COLORS: Record<string, string> = {
  T1: "#e2012d", GEN: "#aa8a00", HLE: "#f37321", KT: "#ff0a07", DK: "#13d6c3",
  BLG: "#00b4e6", TES: "#ff4d00", IG: "#d6d6d6", AL: "#d1232a", JDG: "#c8102e", WBG: "#e6007e", LNG: "#00a3e0",
  G2: "#e8e8e8", KC: "#2d5bff", FNC: "#ff5900", MKOI: "#1e7bff",
  FLY: "#0f9d58", "100T": "#e4202c", C9: "#1fa3f3", TLAW: "#5b7bd5", LYON: "#c9a227",
  CFO: "#f4c20d", PSG: "#d40024", TSW: "#f0f0f0", MVK: "#e63946",
  VKS: "#e6007a", LOS: "#ff7a00", FUR: "#9a9a9a",
};

export const teamColor = (code: string) => COLORS[code] ?? "#8a8a8a";
