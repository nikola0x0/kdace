"use client";
// Header account: the AXP pill (balance you can still bet), and an account menu (avatar, name, chevron) with your
// photo, wallet address, favourite role, balance, AXP in play, your bets, the leaderboard and sign-out.
import { Camera, Check, ChevronDown, Copy, LogOut, Ticket, Trophy } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PERSONAS } from "../../lib/personas";
import { Axp, RoleIcon } from "./bits";
import Pnl from "./Pnl";
import { useFans } from "./FanProvider";

/** Center-crops a picked photo to a 256px square, WebP where the browser can encode it (JPEG otherwise). */
async function squarePhoto(file: File): Promise<string> {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
  URL.revokeObjectURL(img.src);
  const webp = canvas.toDataURL("image/webp", 0.85);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
}

export default function UserButton() {
  const { me, ready, signIn, signOut, available, open, updateProfile } = useFans();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!ready) return <span style={{ width: 88 }} />;
  if (!me) return <button className="btn sm" onClick={signIn}>Sign in</button>;

  const settled = me.axp?.settled ?? 0;
  const inPlay = me.axp?.open ?? 0;
  const openPositions = Object.values(open).filter((o) => Object.keys(o.mine.winner ?? {}).length || Object.keys(o.mine.score ?? {}).length).length;
  const initials = me.displayName.replace(/^0x/, "").slice(0, 2).toUpperCase();
  const team = PERSONAS.find((p) => p.role === me.favRole);
  const avatar = (size: string) =>
    me.avatarUrl ? <img src={me.avatarUrl} alt="" referrerPolicy="no-referrer" className={`${size} rounded-full object-cover`} /> : <span className={`${size} grid place-items-center rounded-full bg-neutral-800 text-[10px] font-bold text-neutral-300`}>{initials}</span>;

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      if (await updateProfile({ image: await squarePhoto(file) })) toast.success("Photo updated");
    } catch {
      toast.error("That image couldn't be read. Try a JPG or PNG.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function copyAddress() {
    await navigator.clipboard.writeText(me!.address);
    setCopied(true);
    toast.success("Wallet address copied");
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span className="flex items-center gap-2">
      <Link href="/me" className="axp-pill" title="Your balance: AXP you can still bet">
        <Axp size={18} /><b className="num">{available.toLocaleString("en-US")}</b><Pnl net={settled} hideZero className="text-[11px]" />
      </Link>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="flex h-9 items-center gap-2 rounded-full border border-input bg-secondary py-1 pl-1 pr-2.5 text-sm font-semibold transition-colors hover:border-neutral-500 hover:bg-accent data-[state=open]:border-neutral-500">
          {avatar("size-7")}
          <span className="max-w-[120px] truncate max-md:hidden">{me.displayName}</span>
          {team && <RoleIcon role={team.role} size={14} />}
          <ChevronDown className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 border-border bg-[#0d0d0d] p-1.5">
          <DropdownMenuLabel className="flex items-center gap-3 p-2 font-normal">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} title="Change photo" className="group relative shrink-0 rounded-full">
              <motion.span key={me.avatarUrl ?? "none"} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="block">{avatar("size-11")}</motion.span>
              <span className={cn("absolute inset-0 grid place-items-center rounded-full bg-black/60 transition-opacity", uploading ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                <Camera className={cn("size-4", uploading && "animate-pulse")} />
              </span>
            </button>
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-sm font-semibold">{me.displayName}</span>
              <button type="button" onClick={copyAddress} title="Copy wallet address" className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                <span className="tabular-nums">{me.address.slice(0, 6)}…{me.address.slice(-4)}</span>
                {copied ? <Check className="size-3.5 text-win" /> : <Copy className="size-3.5" />}
              </button>
            </span>
          </DropdownMenuLabel>

          <div className="mx-2 mb-2 grid gap-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Your role</span>
              <span>{team ? <>Team <b className="text-foreground">{team.name.replace(/^Agent /, "")}</b></> : "Pick one"}</span>
            </div>
            <div className="grid grid-cols-5 gap-1 rounded-lg bg-secondary p-1">
              {PERSONAS.map((p) => {
                const on = me.favRole === p.role;
                return (
                  <button key={p.role} type="button" title={`${p.role.toUpperCase()} · ${p.name}`} onClick={() => updateProfile({ favRole: on ? null : p.role })} className="relative grid h-8 place-items-center rounded-md">
                    {on && <motion.span layoutId="fav-role" className="absolute inset-0 rounded-md" style={{ background: `${p.color}33`, boxShadow: `inset 0 0 0 1px ${p.color}` }} transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
                    <span className={cn("relative transition-opacity", on ? "opacity-100" : "opacity-50 hover:opacity-100")}><RoleIcon role={p.role} size={18} /></span>
                  </button>
                );
              })}
            </div>
          </div>

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
          <DropdownMenuItem onSelect={() => fileRef.current?.click()} className="cursor-pointer gap-2.5 py-2">
            <Camera className="size-4" /> Change photo
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
