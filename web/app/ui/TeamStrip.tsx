"use client";
// Every Worlds team's logo drifting past under the hero (greyscale until hovered).
import LogoLoop from "./rb/LogoLoop";

export default function TeamStrip({ logos }: { logos: { code: string; src: string }[] }) {
  if (!logos.length) return null;
  return (
    <div className="team-strip">
      <LogoLoop
        logos={logos.map((l) => ({ src: l.src, alt: l.code, title: l.code }))}
        speed={40}
        logoHeight={34}
        gap={56}
        fadeOut
        fadeOutColor="#000000"
        scaleOnHover
        ariaLabel="Worlds 2026 teams"
      />
    </div>
  );
}
