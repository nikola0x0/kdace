"use client";
// Your own position, pinned to the bottom of the screen while you scroll the leaderboard.
import { useFans } from "../ui/FanProvider";

export default function MeRow({ rows }: { rows: { player: string; rank: number; balance: number; net: number }[] }) {
  const { me } = useFans();
  if (!me) return null;
  const r = rows.find((x) => x.player === `fan:${me.address}`);
  return (
    <div className="me-pin">
      <span className="num">{r ? `#${r.rank}` : "-"}</span>
      <b>{me.displayName} <span className="tag">You</span></b>
      <b className="num">{(r?.balance ?? me.axp?.start ?? 10_000).toLocaleString("en-US")} AXP</b>
      <span className={`num ${(r?.net ?? 0) >= 0 ? "right" : "wrong"}`}>{(r?.net ?? 0) >= 0 ? "+" : ""}{(r?.net ?? 0).toLocaleString("en-US")}</span>
    </div>
  );
}
