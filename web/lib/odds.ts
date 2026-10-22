// Money-weighted odds for a winner market: how much AXP the analysts and the fans have on each side, and what each
// side would pay from the whole pool if the market closed now (parimutuel: total pool / AXP on that side).
export type Odds = {
  aiPctA: number | null; aiTotal: number;
  fanPctA: number | null; fanTotal: number;
  pool: number;
  multA: number | null; multB: number | null;
};

export function winnerOdds(a: string, b: string, aiPool: Record<string, number>, fanPool: Record<string, number> = {}): Odds {
  const ai = { a: aiPool[a] ?? 0, b: aiPool[b] ?? 0 }, fan = { a: fanPool[a] ?? 0, b: fanPool[b] ?? 0 };
  const aiTotal = ai.a + ai.b, fanTotal = fan.a + fan.b;
  const sideA = ai.a + fan.a, sideB = ai.b + fan.b, pool = sideA + sideB;
  return {
    aiPctA: aiTotal ? (ai.a / aiTotal) * 100 : null, aiTotal,
    fanPctA: fanTotal ? (fan.a / fanTotal) * 100 : null, fanTotal,
    pool,
    multA: sideA ? pool / sideA : null,
    multB: sideB ? pool / sideB : null,
  };
}

export const multText = (m: number | null) => (m === null ? "no bets" : `${m.toFixed(2)}×`);
export const axpShort = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString("en-US"));
