"use client";
// The home banner as a live dither: ordered-dither pixels in the art's own colours, full colour following the cursor
// and a colour ripple on click. WebGL is browser-only, so it loads after hydration.
import dynamic from "next/dynamic";

const DitherVeil = dynamic(() => import("./DitherVeil"), { ssr: false });

export default function HeroVeil({ src }: { src: string }) {
  return (
    <DitherVeil
      src={src}
      fit="cover"
      pattern="bayer"
      palette="rgb"
      levels={4}
      pixelSize={2}
      inkColor="#000000"
      paperColor="#ffffff"
      contrast={1.2}
      revealRadius={170}
      softness={0.7}
      linger={1.4}
      clickBurst
    />
  );
}
