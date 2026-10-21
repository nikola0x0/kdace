import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "KDAce", description: "Who actually reads Worlds? Five AI analysts, every pick committed on Sui, every lesson on Walrus." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
