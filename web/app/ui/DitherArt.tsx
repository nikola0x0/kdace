"use client";
// Full-colour art that melts into the page along a wavy band of tiny ordered-dither (Bayer) pixels, with a black fade
// at the top. Draws the image at `src`, or a placeholder arena scene until the real art arrives.
import { useEffect, useRef } from "react";

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const PALETTES: Record<string, [string, string, string]> = {
  hero: ["rgba(240,190,90,.85)", "rgba(70,130,255,.8)", "rgba(255,70,170,.55)"],
  swiss: ["rgba(90,160,255,.8)", "rgba(40,90,220,.7)", "rgba(120,220,255,.5)"],
  quarterfinals: ["rgba(170,110,255,.8)", "rgba(90,60,220,.7)", "rgba(255,120,220,.5)"],
  semifinals: ["rgba(255,80,90,.8)", "rgba(200,40,60,.7)", "rgba(255,170,80,.5)"],
  final: ["rgba(255,205,90,.9)", "rgba(230,150,40,.7)", "rgba(255,245,200,.6)"],
};

function placeholder(w: number, h: number, palette: string) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const [a, b, d] = PALETTES[palette] ?? PALETTES.hero;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0a1430");
  bg.addColorStop(1, "#140b26");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const glow = (x: number, y: number, r: number, col: string) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  };
  glow(w * 0.62, h * 0.45, Math.max(w, h) * 0.45, a);
  glow(w * 0.12, h * 0.05, Math.max(w, h) * 0.35, b);
  glow(w * 0.95, h * 0.1, Math.max(w, h) * 0.3, d);
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 9; i++) {
    const x = w * (0.04 + i * 0.12);
    const gr = g.createLinearGradient(x, 0, x, h);
    gr.addColorStop(0, "rgba(255,240,210,.28)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x - 6, 0);
    g.lineTo(x + 6, 0);
    g.lineTo(x + w * 0.06 - i * w * 0.012, h);
    g.lineTo(x - w * 0.06 + i * w * 0.012, h);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  const tx = w * 0.62, s = h * 0.22;
  g.fillStyle = "rgba(255,226,160,.92)";
  g.beginPath();
  g.moveTo(tx - s * 0.6, h * 0.18);
  g.lineTo(tx + s * 0.6, h * 0.18);
  g.quadraticCurveTo(tx + s * 0.55, h * 0.42, tx, h * 0.46);
  g.quadraticCurveTo(tx - s * 0.55, h * 0.42, tx - s * 0.6, h * 0.18);
  g.fill();
  g.fillRect(tx - s * 0.06, h * 0.46, s * 0.12, h * 0.1);
  g.fillRect(tx - s * 0.4, h * 0.56, s * 0.8, h * 0.03);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `hsl(${230 + ((i * 37) % 60)},40%,${9 + (i % 4) * 4}%)`;
    g.beginPath();
    g.arc((i * w) / 150, h * 0.88 + Math.sin(i * 1.7) * h * 0.02, h * (0.04 + (i % 3) * 0.01), 0, 7);
    g.fill();
  }
  return c;
}

function cover(img: CanvasImageSource & { width: number; height: number }, w: number, h: number, focusX: number, focusY: number, zoom: number, shift: number, content: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const scale = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * scale, dh = img.height * scale;
  // `shift` moves the image's centre right by a share of the content column, so art lines up with the page layout at any width.
  const x = shift ? (w - dw) / 2 + shift * Math.min(w, content) : (w - dw) * focusX;
  c.getContext("2d")!.drawImage(img, x, (h - dh) * focusY, dw, dh);
  return c;
}

/** focusX/focusY pick which part of an oversized image stays in view (0 = left/top, 1 = right/bottom); zoom > 1 crops in. */
export default function DitherArt({ src, palette = "hero", className = "", dim = true, band = 0.42, focusX = 0.5, focusY = 0.35, zoom = 1, shift = 0 }: { src?: string | null; palette?: string; className?: string; dim?: boolean; band?: number; focusX?: number; focusY?: number; zoom?: number; shift?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = box.current!, cv = canvas.current!;
    let img: HTMLImageElement | null = null;
    let raf = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(el.clientWidth * dpr)), h = Math.max(1, Math.round(el.clientHeight * dpr));
      cv.width = w;
      cv.height = h;
      const source = img?.complete && img.naturalWidth ? cover(img, w, h, focusX, focusY, zoom, shift, 1180 * dpr) : placeholder(w, h, palette);
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(source, 0, 0);
      const data = source.getContext("2d")!.getImageData(0, 0, w, h).data;
      const cell = Math.max(2, Math.round(3 * dpr));
      for (let y = 0; y < h; y += cell) {
        for (let x = 0; x < w; x += cell) {
          const edge = h * (1 - band + 0.08 * Math.sin((x / w) * Math.PI * 2.2 + 0.6));
          const m = (y - edge) / (h * band * 0.9);
          if (m <= 0) continue;
          const t = (BAYER[(y / cell) % 4][(x / cell) % 4] + 0.5) / 16;
          if (m > t) ctx.fillStyle = "#000";
          else {
            const i = ((Math.min(h - 1, y + (cell >> 1)) * w) + Math.min(w - 1, x + (cell >> 1))) * 4;
            ctx.fillStyle = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
          }
          ctx.fillRect(x, y, cell, cell);
        }
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };

    if (src) {
      img = new Image();
      img.onload = schedule;
      img.src = src;
    }
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [src, palette, band, focusX, focusY, zoom, shift]);

  return (
    <div ref={box} className={`art ${className}`}>
      <canvas ref={canvas} aria-hidden />
      {dim && <div className="dim" />}
    </div>
  );
}
