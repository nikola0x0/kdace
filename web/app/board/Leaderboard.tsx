"use client";
// Podium, table and your pinned row. Analysts arrive from the server; fans are fetched live.
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Avatar, Axp, RoleIcon } from "../ui/bits";
import Pnl from "../ui/Pnl";
import { useFans } from "../ui/FanProvider";

export type LbRow = { player: string; name: string; role?: string; /** A fan's favourite role. */ fav?: string | null; color?: string; art?: string | null; /** Balance + in play: what the board ranks by. */ total: number; net: number; inPlay: number; w: number; l: number };
type FanApiRow = { address: string; displayName: string; avatarUrl?: string | null; favRole?: string | null; total: number; balance: number; net: number; inPlay: number };
const fmt = (n: number) => n.toLocaleString("en-US");

export default function Leaderboard({ analysts, fanRecords }: { analysts: LbRow[]; fanRecords: Record<string, { w: number; l: number }> }) {
  const { me } = useFans();
  const [fans, setFans] = useState<LbRow[]>([]);
  useEffect(() => {
    fetch("/api/leaderboard").then((r) => (r.ok ? r.json() : { fans: [] })).then((b: { fans: FanApiRow[] }) =>
      setFans(b.fans.map((f) => ({ player: `fan:${f.address}`, name: f.displayName, art: f.avatarUrl ?? null, fav: f.favRole ?? null, total: f.total, net: f.net, inPlay: f.inPlay, w: fanRecords[f.address]?.w ?? 0, l: fanRecords[f.address]?.l ?? 0 }))),
    ).catch(() => {});
  }, [fanRecords]);

  const rows = [...analysts, ...fans].sort((a, b) => b.total - a.total || b.inPlay - a.inPlay || a.name.localeCompare(b.name));
  const podium = rows.slice(0, 3);
  const order = [1, 0, 2].filter((i) => podium[i]);
  const mineIdx = me ? rows.findIndex((r) => r.player === `fan:${me.address}`) : -1;

  const who = (r: LbRow, size: number) =>
    r.role ? <Avatar name={r.name} color={r.color!} art={r.art} size={size} />
      : r.art ? <img className="pod-fan" src={r.art} alt="" referrerPolicy="no-referrer" style={{ width: size, height: size, objectFit: "cover" }} />
      : <span className="pod-fan" style={{ width: size, height: size }}>{r.name.replace(/^0x/, "").slice(0, 2).toUpperCase()}</span>;

  return (
    <>
      <div className="podium">
        {order.map((i) => {
          const r = podium[i];
          return (
            <div key={r.player} className={`pod p${i + 1}`} style={{ "--c": r.color ?? "#ffffff" } as CSSProperties}>
              <span className="pod-rank display">{i + 1}</span>
              {who(r, i === 0 ? 76 : 60)}
              <b className="pod-name">{r.name}</b>
              <span className="pod-bal num"><Axp size={20} /> {fmt(r.total)}</span>
              <Pnl net={r.net} />
            </div>
          );
        })}
      </div>

      <div className="lpanel">
        <div className="lb-head"><span>#</span><span>Player</span><span>Total</span><span>Balance</span><span>In play</span><span>Profit</span></div>
        {rows.map((r, i) => (
          <div key={r.player} className={`lb-row ${i === mineIdx ? "me" : ""}`}>
            <span className="num muted">{i + 1}</span>
            {r.role ? (
              <Link href={`/analysts/${r.role}`} className="who">{who(r, 30)}{r.name} <RoleIcon role={r.role} /><span className="tag">AI</span></Link>
            ) : (
              <span className="who">{who(r, 30)}{r.name}{r.fav && <RoleIcon role={r.fav} />}{i === mineIdx ? <span className="tag you">You</span> : <span className="tag">Fan</span>}</span>
            )}
            <b className="num bal"><Axp size={15} /> {fmt(r.total)}</b>
            <span className="num">{fmt(r.total - r.inPlay)}</span>
            <span className="num muted">{r.inPlay ? fmt(r.inPlay) : "-"}</span>
            <span className="flex items-center gap-2"><Pnl net={r.net} /><small className="num muted">{r.net > 0 ? "+" : ""}{fmt(r.net)} · {r.w}–{r.l}</small></span>
          </div>
        ))}
      </div>

      {mineIdx >= 0 && (
        <div className="me-pin">
          <span className="num">#{mineIdx + 1}</span>
          <b>{rows[mineIdx].name} <span className="tag you">You</span></b>
          <b className="num bal"><Axp size={15} /> {fmt(rows[mineIdx].total)}</b>
          <span className="num muted">{fmt(rows[mineIdx].total - rows[mineIdx].inPlay)} balance · {fmt(rows[mineIdx].inPlay)} in play</span>
        </div>
      )}
    </>
  );
}
