"use client";
// "Locks in 3h 12m" / "Picks closed", ticking every second near the lock.
import { useEffect, useState } from "react";

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
};

export default function Countdown({ lockAt }: { lockAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className="lock">&nbsp;</span>;
  const left = Date.parse(lockAt) - now;
  if (left <= 0) return <span className="lock">Picks closed</span>;
  return <span className={`lock num ${left < 3600_000 ? "closing" : ""}`}>Locks in {fmt(left)}</span>;
}
