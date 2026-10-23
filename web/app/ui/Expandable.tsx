"use client";
// Text clamped to a couple of lines; a click shows the rest (and hides it again).
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function Expandable({ text, lines = 2, className }: { text: string; lines?: 2 | 3; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? "Show less" : "Show more"} className={cn("block w-full cursor-pointer text-left", !open && (lines === 2 ? "line-clamp-2" : "line-clamp-3"), className)}>
      {text}
    </button>
  );
}
