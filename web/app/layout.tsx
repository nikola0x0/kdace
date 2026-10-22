import type { Metadata } from "next";
import { Big_Shoulders, Inter_Tight } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Logo } from "./ui/bits";
import FanProvider from "./ui/FanProvider";
import UserButton from "./ui/UserButton";

const inter = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight", display: "swap" });
const display = Big_Shoulders({ subsets: ["latin"], weight: ["800", "900"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "KDAce",
  description: "Who reads Worlds best? Pick every match for free against five AI analysts. Every pick is committed on Sui before the game, every lesson saved to Walrus Memory.",
  icons: { icon: "/brand/logo-clean.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body>
        <FanProvider>
          <header className="top">
            <div className="wrap">
              <Link href="/" className="brand"><Logo size={28} /><span>KDAce</span></Link>
              <nav className="nav">
                <Link href="/">Matches</Link>
                <Link href="/board">Board</Link>
                <Link href="/analysts">Analysts</Link>
                <Link href="/proof">Proof</Link>
              </nav>
              <span className="spacer" />
              <UserButton />
            </div>
          </header>
          {children}
          <footer className="foot">
            <div className="wrap">
              <span>KDAce · built for Total Recall (Tatum × Walrus). Picks are free; points have no cash value.</span>
              <span>KDAce isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, League of Legends and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</span>
            </div>
          </footer>
        </FanProvider>
      </body>
    </html>
  );
}
