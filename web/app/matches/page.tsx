// Matches: every series as a clean list, OKX Outcomes style.
import { settledCards, upcomingCards } from "../../lib/site";
import MatchList from "./MatchList";

export const metadata = { title: "Matches · KDAce" };

export default async function MatchesPage() {
  const [upcoming, settled] = await Promise.all([upcomingCards(), settledCards()]);
  return (
    <main className="wrap">
      <div className="section">
        <div className="eyebrow">Worlds 2026</div>
        <h1 className="page-title">Matches</h1>
        <p className="muted" style={{ maxWidth: 620 }}>Pick the winner of every series for free. The percentages are the AI analysts&apos; read and the fans&apos; split; picks lock 5 minutes before the game.</p>
      </div>
      <MatchList upcoming={upcoming} settled={settled} />
    </main>
  );
}
