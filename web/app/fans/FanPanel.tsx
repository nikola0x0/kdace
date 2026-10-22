"use client";
// Minimal, deliberately unstyled fan pick flow: sign in with Google (verified ID token → zkLogin address) or connect
// any Sui wallet and sign a message, pick each open series, see your picks. The real UI is designed separately; this only proves the flow.
import { useCallback, useEffect, useState } from "react";
import { DAppKitProvider, useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { dAppKit } from "./dapp-kit";
import GoogleSignIn, { googleSignOut } from "./GoogleSignIn";

type Series = { matchId: string; startTime: string; block: string; bestOf: 1 | 3 | 5; teamA: string; teamB: string };
type OpenSeries = { series: Series; lockAt: string; crowd: { fans: number; winner: Record<string, number>; score: Record<string, number> }; mine: Partial<Record<"winner" | "score", string>> };
type Me = { address: string; displayName: string; picks: { matchId: string; market: string; choice: string; updatedAt: string }[] };

const SCORES: Record<number, string[]> = { 1: [], 3: ["2-0", "2-1"], 5: ["3-0", "3-1", "3-2"] };

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T & { error?: string } }> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" }, credentials: "same-origin" });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

function Fans() {
  const account = useCurrentAccount();
  const kit = useDAppKit();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState<OpenSeries[]>([]);
  const [message, setMessage] = useState<string>("");
  const [receipt, setReceipt] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    const [m, p] = await Promise.all([api<Me>("/api/me"), api<{ series: OpenSeries[] }>("/api/picks")]);
    setMe(m.ok ? m.body : null);
    if (p.ok) setOpen(p.body.series);
    else setMessage(p.body.error ?? `Could not load picks (${p.status})`);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function signIn() {
    if (!account) return;
    setMessage("");
    try {
      const n = await api<{ message: string; network: "testnet" | "mainnet" }>(`/api/auth/nonce?address=${account.address}`);
      if (!n.ok) return setMessage(n.body.error ?? "Sign-in failed");
      const signed = await kit.signPersonalMessage({ message: new TextEncoder().encode(n.body.message), network: n.body.network });
      const v = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ bytes: signed.bytes, signature: signed.signature }) });
      if (!v.ok) return setMessage(v.body.error ?? "Sign-in failed");
      await refresh();
    } catch (e) {
      setMessage(`Sign-in cancelled or failed: ${(e as Error).message}`);
    }
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" });
    googleSignOut();
    setMe(null);
    await refresh();
  }

  async function pick(matchId: string, market: "winner" | "score", choice: string) {
    setMessage("");
    const r = await api<{ receipt: unknown }>("/api/picks", { method: "POST", body: JSON.stringify({ matchId, market, choice }) });
    if (!r.ok) return setMessage(r.body.error ?? `Pick failed (${r.status})`);
    setReceipt(r.body.receipt);
    await refresh();
  }

  const signedIn = !!me && (!account || account.address === me.address);

  return (
    <section>
      <h2>Your picks</h2>
      {!me && <GoogleSignIn onSignedIn={() => { setMessage(""); refresh(); }} onError={setMessage} />}
      <ConnectButton />
      {account && !signedIn && <button onClick={signIn}>Sign in as {account.address.slice(0, 6)}…{account.address.slice(-4)}</button>}
      {me && <p>Signed in as {me.displayName} <button onClick={signOut}>Sign out</button></p>}
      {message && <p>{message}</p>}

      {open.length === 0 && <p>No open series right now.</p>}
      {open.map(({ series: s, lockAt, crowd, mine }) => (
        <div key={s.matchId}>
          <p>
            <b>{s.teamA} vs {s.teamB}</b> · {s.block} · Bo{s.bestOf} · picks lock {new Date(lockAt).toUTCString()} · {crowd.fans} fan(s): {s.teamA} {crowd.winner[s.teamA] ?? 0} / {s.teamB} {crowd.winner[s.teamB] ?? 0}
          </p>
          <div>
            Winner:{" "}
            {[s.teamA, s.teamB].map((t) => (
              <button key={t} disabled={!signedIn} onClick={() => pick(s.matchId, "winner", t)}>{t}{mine.winner === t ? " ✓" : ""}</button>
            ))}
          </div>
          {s.bestOf > 1 && (
            <div>
              Score:{" "}
              {SCORES[s.bestOf].map((sc) => (
                <button key={sc} disabled={!signedIn} onClick={() => pick(s.matchId, "score", sc)}>{sc}{mine.score === sc ? " ✓" : ""} ({crowd.score[sc] ?? 0})</button>
              ))}
            </div>
          )}
        </div>
      ))}

      {receipt !== null && (
        <details>
          <summary>Receipt for your last pick</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(receipt, null, 2)}</pre>
        </details>
      )}

      {me && me.picks.length > 0 && (
        <>
          <h3>My picks</h3>
          <ul>
            {me.picks.map((p) => (
              <li key={`${p.matchId}-${p.market}`}>{p.matchId} {p.market}: {p.choice} ({new Date(p.updatedAt).toUTCString()})</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default function FanPanel() {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <Fans />
    </DAppKitProvider>
  );
}
