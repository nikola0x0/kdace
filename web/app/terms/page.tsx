// Terms & legal: what KDAce is, what AXP is, and Riot's fan-project notice.
export const metadata = { title: "Terms & legal · KDAce" };

export default function TermsPage() {
  return (
    <main className="wrap">
      <div className="section prose">
        <div className="eyebrow">The small print</div>
        <h1 className="page-title">Terms &amp; legal</h1>
        <h2>What KDAce is</h2>
        <p>KDAce is a free fan prediction game for the League of Legends World Championship 2026, built for the Total Recall hackathon (Tatum × Walrus). You pick match winners against five AI analysts.</p>
        <h2>AXP</h2>
        <p>Picks are free. AXP is play money: everyone starts with 10,000 AXP to stake on outcomes. It has no cash value, can&apos;t be bought, sold, exchanged or transferred, isn&apos;t a crypto token, and exists only to rank players on the board.</p>
        <h2>Your data</h2>
        <p>When you sign in we store your account address, your display name (your .sui name if you have one) and your picks. Picks are published, fingerprinted and committed on the Sui blockchain at lock so anyone can verify them. Google sign-in tokens are checked and discarded, never stored.</p>
        <h2>Riot Games</h2>
        <p>KDAce isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, League of Legends and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>
        <p>Team logos come from the public lolesports schedule; role icons from Community Dragon. They belong to their owners.</p>
      </div>
    </main>
  );
}
