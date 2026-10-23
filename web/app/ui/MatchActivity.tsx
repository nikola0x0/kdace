"use client";
// Latest buys on one match, refreshed every 15 seconds.
import { useEffect, useState } from "react";
import { Axp } from "./bits";
import LocalTime from "./LocalTime";

type Buy = { id: number; choice: string; market: string; amount: number; name: string; avatarUrl: string | null; at: string };

export default function MatchActivity({ matchId }: { matchId: string }) {
  const [buys, setBuys] = useState<Buy[] | null>(null);
  useEffect(() => {
    const load = () => fetch(`/api/activity?matchId=${matchId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { buys: [] })).then((b) => setBuys(b.buys)).catch(() => setBuys([]));
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [matchId]);
  return (
    <div className="panel">
      <h3 className="m-0 mb-3 text-base font-bold">Live bets</h3>
      {buys === null ? <p className="muted" style={{ margin: 0 }}>Loading…</p> : buys.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No bets yet. Be the first.</p>
      ) : (
        <ul className="grid gap-2">
          {buys.map((b) => (
            <li key={b.id} className="flex items-center gap-2.5 text-sm">
              {b.avatarUrl ? <img src={b.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-6 rounded-full object-cover" /> : <span className="grid size-6 place-items-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground">{b.name.replace(/^0x/, "").slice(0, 2).toUpperCase()}</span>}
              <span className="min-w-0 flex-1 truncate"><b>{b.name}</b> <span className="text-muted-foreground">bought</span> <b>{b.choice}</b>{b.market === "score" ? <span className="text-muted-foreground"> (score)</span> : null}</span>
              <span className="inline-flex items-center gap-1 font-semibold tabular-nums"><Axp size={13} />{b.amount.toLocaleString("en-US")}</span>
              <span className="w-14 text-right text-xs text-muted-foreground"><LocalTime iso={b.at} format="time" /></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
