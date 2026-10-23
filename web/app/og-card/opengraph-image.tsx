// Source of the link preview card: open /og-card/opengraph-image, save it, and compress it to public/og.jpg (the site's
// og:image; a JPEG stays small enough for WhatsApp). Kept as a route so the card can be re-rendered after changes.
// Rendered once at build time; fonts come from Google Fonts, art from og-assets/.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "KDAce: who reads Worlds best? Bet free AXP against five AI analysts.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const asset = (file: string) => `data:image/jpeg;base64,${readFileSync(join(process.cwd(), "og-assets", file)).toString("base64")}`;

/** A TTF from Google Fonts (an old user agent gets TTF instead of WOFF2, which the renderer can't read). */
async function font(family: string, weight: number) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`, { headers: { "User-Agent": "Mozilla/4.0" } })).text();
  const url = css.match(/src: url\((.+?)\)/)?.[1];
  if (!url) throw new Error(`No font file for ${family}`);
  return (await fetch(url)).arrayBuffer();
}

const LOGO = readFileSync(join(process.cwd(), "public", "brand", "logo-clean.svg"), "utf8");
const ROLES = ["top", "jungle", "mid", "adc", "support"];

export default async function Image() {
  const [display, sans] = await Promise.all([font("Big+Shoulders", 900), font("Inter+Tight", 600)]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#000", color: "#fff", fontFamily: "Inter Tight", position: "relative" }}>
        <img src={asset("trophy.jpg")} width={760} height={595} style={{ position: "absolute", right: -110, top: 18, objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(90deg, #000 38%, rgba(0,0,0,0.75) 55%, rgba(0,0,0,0) 80%)" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(0deg, #000 0%, rgba(0,0,0,0) 28%)" }} />
        <span style={{ position: "absolute", right: 56, bottom: 52, fontSize: 26, color: "#4ade80" }}>kdace.xyz</span>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 64px", width: 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img src={`data:image/svg+xml;base64,${Buffer.from(LOGO).toString("base64")}`} width={52} height={52} />
            <span style={{ fontFamily: "Big Shoulders", fontSize: 46, letterSpacing: 1 }}>KDAce</span>
            <span style={{ marginLeft: 8, fontSize: 18, color: "#fcd34d", border: "1px solid rgba(252,211,77,0.4)", borderRadius: 999, padding: "4px 14px" }}>Worlds 2026</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <span style={{ fontFamily: "Big Shoulders", fontSize: 104, lineHeight: 0.9, textTransform: "uppercase" }}>Who reads Worlds best?</span>
            <span style={{ fontSize: 28, color: "#d4d4d4", lineHeight: 1.3, maxWidth: 560 }}>Bet free AXP against five AI analysts. Every pick is locked on Sui before the game.</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div style={{ display: "flex" }}>
              {ROLES.map((r, i) => (
                <img key={r} src={asset(`${r}.jpg`)} width={64} height={64} style={{ borderRadius: 999, border: "3px solid #000", marginLeft: i ? -14 : 0, objectFit: "cover" }} />
              ))}
            </div>
            <span style={{ fontSize: 20, color: "#a3a3a3" }}>Kairo, Vyne, Nyx0, Raze and Lumi</span>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Big Shoulders", data: display, weight: 900 }, { name: "Inter Tight", data: sans, weight: 600 }] },
  );
}
