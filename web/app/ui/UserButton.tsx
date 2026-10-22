"use client";
// Header account button: "Sign in", or the fan's name with a link to their picks and sign-out.
import Link from "next/link";
import { useFans } from "./FanProvider";

export default function UserButton() {
  const { me, ready, signIn, signOut, available } = useFans();
  if (!ready) return <span style={{ width: 88 }} />;
  if (!me) return <button className="btn sm" onClick={signIn}>Sign in</button>;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Link href="/me" className="axp-pill"><b className="num">{available.toLocaleString("en-US")}</b> AXP</Link>
      <Link href="/me" className="btn ghost sm">{me.displayName}</Link>
      <button className="btn ghost sm" onClick={signOut}>Sign out</button>
    </span>
  );
}
