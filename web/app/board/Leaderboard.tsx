"use client";
// Podium, table and your pinned row. Analysts arrive from the server; fans are fetched live.
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Avatar, Axp, RoleIcon } from "../ui/bits";
import { useFans } from "../ui/FanProvider";

export type LbRow = { player: string; name: string; role?: string; color?: string; art?: string | null; balance: number; net: number; inPlay: number; w: number; l: number };
type FanApiRow = { address: string; displayName: string; balance: number; net: number; inPlay: number };
const fmt = (n: number) => n.toLocaleString("en-US");

export default function Leaderboard({ analysts, fanRecords }: { analysts: LbRow[]; fanRecords: Record<string, { w: number; l: number }> }) {
  const { me } = useFans();
  const [fans, setFans] = useState<LbRow[]>([]);
  useEffect(() => {
    fetch("/api/leaderboard").then((r) => (r.ok ? r.json() : { fans: [] })).then((b: { fans: FanApiRow[] }) =>
      setFans(b.fans.map((f) => ({ player: `fan:${f.address}`, name: f.displayName, balance: f.balance, net: f.net, inPlay: f.inPlay, w: fanRecords[f.address]?.w ?? 0, l: fanRecords[f.address]?.l ?? 0 }))),
    ).catch(() => {});
  }, [fanRecords]);

  const rows = [...analysts, ...fans].sort((a, b) => b.balance - a.balance || b.inPlay - a.inPlay || a.name.localeCompare(b.name));
  const podium = rows.slice(0, 3);
  const order = [1, 0, 2].filter((i) => podium[i]);
  const mineIdx = me ? rows.findIndex((r) => r.player === `fan:${me.address}`) : -1;

  const who = (r: LbRow, size: number) =>
    r.role ? <Avatar name={r.name} color={r.color!} art={r.art} size={size} /> : <span className="pod-fan" style={{ width: size, height: size }}>{r.name.replace(/^0x/, "").slice(0, 2).toUpperCase()}</span>;

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
              <span className="pod-bal num"><Axp size={20} /> {fmt(r.balance)}</span>
              <span className={`num ${r.net > 0 ? "right" : r.net < 0 ? "wrong" : "muted"}`}>{r.net > 0 ? "+" : ""}{fmt(r.net)}</span>
            </div>
          );
        })}
      </div>

      <div className="lpanel">
        <div className="lb-head"><span>#</span><span>Player</span><span>Balance</span><span>Profit</span><span>In play</span><span>Record</span></div>
        {rows.map((r, i) => (
          <div key={r.player} className={`lb-row ${i === mineIdx ? "me" : ""}`}>
            <span className="num muted">{i + 1}</span>
            {r.role ? (
              <Link href={`/analysts/${r.role}`} className="who">{who(r, 30)}{r.name} <RoleIcon role={r.role} /><span className="tag">AI</span></Link>
            ) : (
              <span className="who">{who(r, 30)}{r.name}{i === mineIdx ? <span className="tag you">You</span> : <span className="tag">Fan</span>}</span>
            )}
            <b className="num bal"><Axp size={15} /> {fmt(r.balance)}</b>
            <span className={`num ${r.net > 0 ? "right" : r.net < 0 ? "wrong" : "muted"}`}>{r.net > 0 ? "+" : ""}{fmt(r.net)}</span>
            <span className="num muted">{r.inPlay ? fmt(r.inPlay) : "-"}</span>
            <span className="num muted">{r.w}–{r.l}</span>
          </div>
        ))}
      </div>

      {mineIdx >= 0 && (
        <div className="me-pin">
          <span className="num">#{mineIdx + 1}</span>
          <b>{rows[mineIdx].name} <span className="tag you">You</span></b>
          <b className="num bal"><Axp size={15} /> {fmt(rows[mineIdx].balance)}</b>
          <span className="num muted">{rows[mineIdx].inPlay ? `${fmt(rows[mineIdx].inPlay)} in play` : ""}</span>
        </div>
      )}
    </>
  );
}
