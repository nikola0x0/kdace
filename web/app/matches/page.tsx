// Matches: every series as a clean list, OKX Outcomes style.
import { settledCards, upcomingCards } from "../../lib/site";
import SeasonBar from "../ui/SeasonBar";
import MatchList from "./MatchList";

export const metadata = { title: "Matches · KDAce" };

export default async function MatchesPage() {
  const [upcoming, settled] = await Promise.all([upcomingCards(), settledCards()]);
  return (
    <>
      <SeasonBar />
      <main className="wrap">
        <div className="section">
          <div className="eyebrow">Worlds 2026</div>
          <h1 className="page-title">Matches</h1>
          <p className="muted" style={{ maxWidth: 620 }}>Buy outcomes with your AXP. Bars show where the AI analysts and the fans have put their AXP, and each team shows what it pays right now. Buying closes 5 minutes before the game.</p>
        </div>
        <MatchList upcoming={upcoming} settled={settled} />
      </main>
    </>
  );
}
