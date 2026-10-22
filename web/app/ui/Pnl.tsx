// Profit or loss against the 10,000 AXP everyone starts with: double arrow plus percentage, like a trading app.
import { ChevronsDown, ChevronsUp } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Pnl({ net, start = 10_000, className, hideZero = false }: { net: number; start?: number; className?: string; hideZero?: boolean }) {
  if (net === 0 && hideZero) return null;
  const pct = (net / start) * 100;
  const up = net > 0, down = net < 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular-nums", up ? "text-win" : down ? "text-loss" : "text-muted-foreground", className)}>
      {up && <ChevronsUp className="size-3.5" strokeWidth={2.5} />}
      {down && <ChevronsDown className="size-3.5" strokeWidth={2.5} />}
      {up ? "+" : ""}{pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%
    </span>
  );
}
