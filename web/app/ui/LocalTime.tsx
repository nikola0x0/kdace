"use client";
// A date or time in the viewer's own timezone (rendered after mount, so server and browser never disagree).
import { useEffect, useState } from "react";

const FORMATS = {
  day: { weekday: "long", month: "short", day: "numeric" },
  short: { weekday: "short", hour: "2-digit", minute: "2-digit" },
  time: { hour: "2-digit", minute: "2-digit" },
  full: { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
} as const;

export default function LocalTime({ iso, format = "short" }: { iso: string; format?: keyof typeof FORMATS }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(new Date(iso).toLocaleString(undefined, FORMATS[format])), [iso, format]);
  return <time dateTime={iso}>{text ?? " "}</time>;
}
