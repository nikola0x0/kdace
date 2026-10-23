"use client";
// Podium, table and your pinned row. Analysts arrive from the server; fans are fetched live.
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { Avatar, Axp, RoleIcon } from "../ui/bits";
import Pnl from "../ui/Pnl";
import CountUp from "../ui/rb/CountUp";
import { motion } from "motion/react";
import { useFans } from "../ui/FanProvider";
import { useChampions } from "../ui/useChampions";

export type LbRow = { player: string; name: string; role?: string; /** A fan's favourite role. */ fav?: string | null; /** A fan's favourite champions. */ champs?: string[]; color?: string; art?: string | null; /** Balance + in play: what the board ranks by. */ total: number; net: number; inPlay: number; w: number; l: number };
type FanApiRow = { address: string; displayName: string; avatarUrl?: string | null; favRole?: string | null; favChamps?: string[]; total: number; balance: number; net: number; inPlay: number };
const fmt = (n: number) => n.toLocaleString("en-US");
const CACHE_KEY = "kdace.board.fans";

export default function Leaderboard({ analysts, fanRecords }: { analysts: LbRow[]; fanRecords: Record<string, { w: number; l: number }> }) {
  const { me } = useFans();
  const champ = useChampions();
  // null until the fans arrive, so the board never flashes with only the analysts on it. The last board is kept in
  // this browser and shown straight away on the next visit while a fresh one loads.
  const [fans, setFans] = useState<LbRow[] | null>(null);
  useEffect(() => {
    const toRows = (list: FanApiRow[]) => list.map((f) => ({ player: `fan:${f.address}`, name: f.displayName, art: f.avatarUrl ?? null, fav: f.favRole ?? null, champs: f.favChamps ?? [], total: f.total, net: f.net, inPlay: f.inPlay, w: fanRecords[f.address]?.w ?? 0, l: fanRecords[f.address]?.l ?? 0 }));
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) setFans(toRows(JSON.parse(cached)));
    } catch {}
    fetch("/api/leaderboard")
      .then((r) => (r.ok ? r.json() : { fans: [] }))
      .then((b: { fans: FanApiRow[] }) => {
        setFans(toRows(b.fans));
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(b.fans)); } catch {}
      })
      .catch(() => setFans((f) => f ?? []));
  }, [fanRecords]);

  if (fans === null) return <BoardSkeleton />;
  const rows = [...analysts, ...fans].sort((a, b) => b.total - a.total || b.inPlay - a.inPlay || a.name.localeCompare(b.name));
  const podium = rows.slice(0, 3);
  const order = [1, 0, 2].filter((i) => podium[i]);
  const mains = (r: LbRow) => r.champs?.map((c) => champ.icon(c) && <img key={c} src={champ.icon(c)!} alt={champ.name(c)} title={champ.name(c)} className="size-5 rounded-full border border-border object-cover" />);
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
              <span className="pod-bal num"><Axp size={20} /> <CountUp to={r.total} from={10_000} duration={1.1} separator="," /></span>
              <Pnl net={r.net} />
            </div>
          );
        })}
      </div>

      <div className="lpanel">
        <div className="lb-head"><span>#</span><span>Player</span><span>Total</span><span>Profit</span></div>
        {rows.map((r, i) => (
          <motion.div layout="position" transition={{ type: "spring", stiffness: 420, damping: 38 }} key={r.player} className={`lb-row ${i === mineIdx ? "me" : ""}`}>
            <span className="num muted">{i + 1}</span>
            {r.role ? (
              <Link href={`/analysts/${r.role}`} className="who">{who(r, 30)}{r.name} <RoleIcon role={r.role} />{mains(r)}<span className="tag">AI</span></Link>
            ) : (
              <span className="who">{who(r, 30)}{r.name}{r.fav && <RoleIcon role={r.fav} />}{mains(r)}{i === mineIdx ? <span className="tag you">You</span> : <span className="tag">Fan</span>}</span>
            )}
            <b className="num bal"><Axp size={15} /> <CountUp to={r.total} from={10_000} duration={1.1} separator="," /></b>
            <span title={`${r.net > 0 ? "+" : ""}${fmt(r.net)} AXP · ${r.w}–${r.l}`}><Pnl net={r.net} /></span>
          </motion.div>
        ))}
      </div>

      {mineIdx >= 0 && (
        <div className="me-pin">
          <span className="num">#{mineIdx + 1}</span>
          <b>{rows[mineIdx].name} <span className="tag you">You</span></b>
          <b className="num bal"><Axp size={15} /> {fmt(rows[mineIdx].total)}</b>
        </div>
      )}
    </>
  );
}

/** Placeholder rows while the fans load. */
function BoardSkeleton() {
  return (
    <div className="lpanel" aria-busy="true" aria-label="Loading the leaderboard">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="lb-row">
          <span className="h-3 w-4 animate-pulse rounded bg-white/10" />
          <span className="flex items-center gap-2.5"><span className="size-[30px] animate-pulse rounded-full bg-white/10" /><span className="h-3 w-32 animate-pulse rounded bg-white/10" /></span>
          <span className="h-3 w-20 animate-pulse rounded bg-white/10" />
          <span className="h-3 w-12 animate-pulse rounded bg-white/10" />
        </div>
      ))}
    </div>
  );
}
