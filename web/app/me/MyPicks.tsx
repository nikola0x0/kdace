"use client";
import Link from "next/link";
import { useFans } from "../ui/FanProvider";
import LocalTime from "../ui/LocalTime";

type Match = { label: string; start: string; result: { winner: string; score: string } | null; fansDigest: string | null; network: string };

export default function MyPicks({ matches }: { matches: Record<string, Match> }) {
  const { me, ready, signIn } = useFans();
  if (!ready) return <div className="panel muted">Loading…</div>;
  if (!me)
    return (
      <div className="panel" style={{ display: "grid", gap: 12, justifyItems: "start" }}>
        <p className="muted" style={{ margin: 0 }}>Sign in to see your picks. Picks are free.</p>
        <button className="btn" onClick={signIn}>Sign in</button>
      </div>
    );
  const byMatch = new Map<string, Record<string, string>>();
  for (const p of me.picks) byMatch.set(p.matchId, { ...(byMatch.get(p.matchId) ?? {}), [p.market]: p.choice });
  const ids = [...byMatch.keys()].sort((a, b) => (matches[b]?.start ?? "").localeCompare(matches[a]?.start ?? ""));

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>Signed in as <b style={{ color: "var(--fg)" }}>{me.displayName}</b>. At lock, everyone&apos;s final picks for a match are fingerprinted together and locked on Sui, so nobody can change them later.</p>
      {ids.length === 0 && <p className="muted">No picks yet. <Link href="/" style={{ color: "var(--fg)" }}>Pick a match →</Link></p>}
      {ids.map((id) => {
        const m = matches[id], mine = byMatch.get(id)!;
        const right = m?.result ? mine.winner === m.result.winner : null;
        return (
          <Link key={id} href={`/match/${id}`} className="call-row">
            <span>{m?.label ?? id} <span className="muted" style={{ fontSize: 13 }}>· <LocalTime iso={m?.start ?? new Date().toISOString()} /></span></span>
            <span className={right === null ? "" : right ? "right" : "wrong"}>
              {mine.winner ?? "-"}{mine.score ? ` ${mine.score}` : ""}{right === null ? (m?.fansDigest ? " · locked on Sui" : " · open") : right ? " ✓" : " ✗"}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
