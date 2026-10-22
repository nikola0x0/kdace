"use client";
// Header account button: "Sign in", or the fan's name with a link to their picks and sign-out.
import Link from "next/link";
import { Axp } from "./bits";
import Pnl from "./Pnl";
import { useFans } from "./FanProvider";

export default function UserButton() {
  const { me, ready, signIn, signOut, available } = useFans();
  if (!ready) return <span style={{ width: 88 }} />;
  if (!me) return <button className="btn sm" onClick={signIn}>Sign in</button>;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Link href="/me" className="axp-pill" title="Available AXP, and profit or loss since you started with 10,000"><Axp size={18} /><b className="num">{available.toLocaleString("en-US")}</b><Pnl net={me.axp?.settled ?? 0} hideZero className="text-[11px]" /></Link>
      <Link href="/me" className="btn ghost sm me-btn">{me.avatarUrl ? <img src={me.avatarUrl} alt="" className="me-avatar" referrerPolicy="no-referrer" /> : null}<span className="me-name-txt">{me.displayName}</span></Link>
      <button className="btn ghost sm signout-btn" onClick={signOut}>Sign out</button>
    </span>
  );
}
