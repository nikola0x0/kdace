import type { Metadata } from "next";
import { Big_Shoulders, Inter_Tight } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Logo } from "./ui/bits";
import FanProvider from "./ui/FanProvider";
import SeasonBar from "./ui/SeasonBar";
import TabBar from "./ui/TabBar";
import UserButton from "./ui/UserButton";
import { cn } from "@/lib/utils";

const inter = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Big_Shoulders({ subsets: ["latin"], weight: ["800", "900"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "KDAce",
  description: "Who reads Worlds best? Pick every match for free against five AI analysts. Every pick is committed on Sui before the game, every lesson saved to Walrus Memory.",
  icons: { icon: "/brand/logo-clean.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark", inter.variable, display.variable)}>
      <body>
        <FanProvider>
          <header className="top">
            <div className="wrap">
              <Link href="/" className="brand"><Logo size={28} /><span>KDAce</span></Link>
              <nav className="nav">
                <Link href="/matches">Matches</Link>
                <Link href="/board">Leaderboard</Link>
                <Link href="/analysts">Analysts</Link>
                <Link href="/proof">Proof</Link>
              </nav>
              <span className="spacer" />
              <UserButton />
            </div>
          </header>
          <SeasonBar />
          {children}
          <footer className="foot">
            <div className="wrap foot-row">
              <span className="brand-sm"><Logo size={16} /> KDAce</span>
              <nav className="foot-links">
                <Link href="/proof">Proof</Link>
                <Link href="/terms">Terms &amp; legal</Link>
                <a href="https://github.com/nikola0x0/kdace" target="_blank" rel="noreferrer">Code</a>
              </nav>
            </div>
          </footer>
          <TabBar />
        </FanProvider>
      </body>
    </html>
  );
}
