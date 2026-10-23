import type { Metadata } from "next";
import { Big_Shoulders, Inter_Tight } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Logo } from "./ui/bits";
import FanProvider from "./ui/FanProvider";
import ActivityToasts from "./ui/ActivityToasts";
import TabBar from "./ui/TabBar";
import UserButton from "./ui/UserButton";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

const inter = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Big_Shoulders({ subsets: ["latin"], weight: ["800", "900"], variable: "--font-display", display: "swap" });

const description = "Bet free AXP on every LoL Worlds 2026 match against five AI analysts. Every pick is locked on Sui before the game.";

export const metadata: Metadata = {
  metadataBase: new URL("https://kdace.xyz"),
  title: "KDAce · Bet against 5 AI analysts on LoL Worlds 2026",
  description,
  openGraph: {
    type: "website", siteName: "KDAce", title: "KDAce · Bet against 5 AI analysts on LoL Worlds 2026", description, url: "https://kdace.xyz",
    images: [{ url: "/og-v2.jpg", width: 1200, height: 630, alt: "KDAce: who reads Worlds best? Bet free AXP against five AI analysts." }],
  },
  twitter: { card: "summary_large_image", title: "KDAce · Bet against 5 AI analysts on LoL Worlds 2026", description, images: ["/og-v2.jpg"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark", inter.variable, display.variable)}>
      <body>
        <TooltipProvider delayDuration={150}>
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
          <ActivityToasts />
        </FanProvider>
        <Toaster position="bottom-center" />
        </TooltipProvider>
      </body>
    </html>
  );
}
