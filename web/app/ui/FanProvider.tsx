"use client";
// Fan state for every page: who's signed in, the live crowd split and your picks per open series, and pick().
// Signing in happens in a dialog; wallets are browser-only, so that dialog loads on demand.
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Crowd = { fans: number; winner: Record<string, number>; score: Record<string, number>; winnerPool: Record<string, number>; scorePool: Record<string, number> };
export type MyBet = { choice: string; stake: number };
export type OpenSeries = { series: { matchId: string }; lockAt: string; crowd: Crowd; mine: Partial<Record<"winner" | "score", MyBet>> };
export type Axp = { start: number; settled: number; open: number; available: number };
export type Me = { address: string; displayName: string; picks: { matchId: string; market: string; choice: string; stake: number; updatedAt: string }[]; axp: Axp };

/** Stake used when a caller doesn't pass one (the stake picker is part of the UI redesign). */
const DEFAULT_STAKE = 100;

type FanState = {
  me: Me | null;
  open: Record<string, OpenSeries>;
  ready: boolean;
  pick(matchId: string, market: "winner" | "score", choice: string, stake?: number): Promise<void>;
  signIn(): void;
  signOut(): Promise<void>;
};

const Ctx = createContext<FanState | null>(null);
export const useFans = () => useContext(Ctx)!;

const SignInDialog = dynamic(() => import("./SignInDialog"), { ssr: false });

async function api<T>(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" }, credentials: "same-origin" });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T & { error?: string } };
}

export default function FanProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState<Record<string, OpenSeries>>({});
  const [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [toast, setToast] = useState("");

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? "" : t)), 3200);
  }, []);

  const refresh = useCallback(async () => {
    const [m, p] = await Promise.all([api<Me>("/api/me"), api<{ series: OpenSeries[] }>("/api/picks")]);
    setMe(m.ok ? m.body : null);
    if (p.ok) setOpen(Object.fromEntries(p.body.series.map((s) => [s.series.matchId, s])));
    setReady(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pick = useCallback(
    async (matchId: string, market: "winner" | "score", choice: string, stake = DEFAULT_STAKE) => {
      if (!me) return setDialog(true);
      const r = await api("/api/picks", { method: "POST", body: JSON.stringify({ matchId, market, choice, stake }) });
      if (!r.ok) return say(r.body.error ?? "That pick couldn't be saved. Please try again.");
      say(`Pick saved: ${choice}`);
      await refresh();
    },
    [me, refresh, say],
  );

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.google?.accounts?.id.disableAutoSelect();
    setMe(null);
    await refresh();
  }, [refresh]);

  return (
    <Ctx.Provider value={{ me, open, ready, pick, signIn: () => setDialog(true), signOut }}>
      {children}
      {dialog && (
        <SignInDialog
          onClose={() => setDialog(false)}
          onSignedIn={async () => {
            setDialog(false);
            await refresh();
            say("You're in. Make your picks!");
          }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </Ctx.Provider>
  );
}
