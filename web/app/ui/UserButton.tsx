"use client";
// Header account: the AXP pill (balance you can still bet), and an account menu (avatar, name, chevron) with your
// balance, AXP in play, your bets, the leaderboard and sign-out.
import { ChevronDown, LogOut, Ticket, Trophy } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Axp } from "./bits";
import Pnl from "./Pnl";
import { useFans } from "./FanProvider";

export default function UserButton() {
  const { me, ready, signIn, signOut, available, open } = useFans();
  if (!ready) return <span style={{ width: 88 }} />;
  if (!me) return <button className="btn sm" onClick={signIn}>Sign in</button>;

  const settled = me.axp?.settled ?? 0;
  const inPlay = me.axp?.open ?? 0;
  const openPositions = Object.values(open).filter((o) => Object.keys(o.mine.winner ?? {}).length || Object.keys(o.mine.score ?? {}).length).length;
  const initials = me.displayName.replace(/^0x/, "").slice(0, 2).toUpperCase();
  const avatar = (size: string) =>
    me.avatarUrl ? <img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" className={`${size} rounded-full object-cover`} /> : <span className={`${size} grid place-items-center rounded-full bg-neutral-800 text-[10px] font-bold text-neutral-300`}>{initials}</span>;

  return (
    <span className="flex items-center gap-2">
      <Link href="/me" className="axp-pill" title="Your balance: AXP you can still bet">
        <Axp size={18} /><b className="num">{available.toLocaleString("en-US")}</b><Pnl net={settled} hideZero className="text-[11px]" />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-9 items-center gap-2 rounded-full border border-input bg-secondary py-1 pl-1 pr-2.5 text-sm font-semibold transition-colors hover:border-neutral-500 hover:bg-accent data-[state=open]:border-neutral-500">
          {avatar("size-7")}
          <span className="max-w-[120px] truncate max-md:hidden">{me.displayName}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 border-border bg-[#0d0d0d] p-1.5">
          <DropdownMenuLabel className="flex items-center gap-3 p-2">
            {avatar("size-9")}
            <span className="truncate text-sm font-semibold">{me.displayName}</span>
          </DropdownMenuLabel>
          <div className="mx-2 mb-1.5 grid grid-cols-2 gap-1.5 text-xs">
            <div className="rounded-md bg-secondary px-2.5 py-2">
              <div className="text-muted-foreground">Balance</div>
              <div className="flex items-center gap-1 text-sm font-bold tabular-nums"><Axp size={13} />{available.toLocaleString("en-US")}</div>
            </div>
            <div className="rounded-md bg-secondary px-2.5 py-2">
              <div className="text-muted-foreground">In play</div>
              <div className="text-sm font-bold tabular-nums">{inPlay.toLocaleString("en-US")}</div>
            </div>
            <div className="col-span-2 flex items-center justify-between px-0.5 text-muted-foreground">
              <span>Profit since start</span><Pnl net={settled} className="text-xs" />
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="cursor-pointer gap-2.5 py-2">
            <Link href="/me"><Ticket className="size-4" /> My bets {openPositions > 0 && <span className="ml-auto rounded-full bg-win px-1.5 text-[11px] font-bold text-black">{openPositions} open</span>}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="cursor-pointer gap-2.5 py-2">
            <Link href="/board"><Trophy className="size-4" /> Leaderboard</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => signOut()} className="cursor-pointer gap-2.5 py-2 text-muted-foreground">
            <LogOut className="size-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
