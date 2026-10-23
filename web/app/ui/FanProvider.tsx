"use client";
// Fan state for every page: who's signed in, their AXP, the live crowd and pools per open series, and the bet slip.
// Signing in happens in a dialog; wallets are browser-only, so that dialog loads on demand.
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { toast } from "sonner";

export type Market = "winner" | "score";
export type Crowd = { fans: number; winner: Record<string, number>; score: Record<string, number>; winnerPool?: Record<string, number>; scorePool?: Record<string, number> };
/** A fan's positions on a series: market -> outcome -> total AXP bought (buys add up, like shares on Outcomes). */
export type Positions = Partial<Record<Market, Record<string, number>>>;
export type OpenSeries = { series: { matchId: string; teamA?: string; teamB?: string }; lockAt: string; crowd: Crowd; mine: Positions };
export type Me = {
  address: string;
  displayName: string;
  /** The name the fan picked (null: SuiNS name or short address is shown). */
  nickname?: string | null;
  avatarUrl?: string | null;
  /** The role the fan cheers for (top, jungle, mid, adc, support). */
  favRole?: string | null;
  /** Up to two favourite champions (Data Dragon ids). */
  favChamps?: string[];
  picks: { matchId: string; market: string; choice: string; stake?: number; updatedAt: string }[];
  /** Every buy, newest first: each one is its own position. */
  buys?: { id: number; matchId: string; market: string; choice: string; amount: number; at: string }[];
  /** Results per settled match; a win waits for a claim. */
  results?: { matchId: string; stake: number; net: number; payout: number; claimable: boolean; claimedAt: string | null }[];
  axp?: { start: number; settled: number; open: number; claimable?: number; available: number };
};
/** What the bet slip needs to show a market: the teams, the analysts' stakes already in the pool, and the format. */
export type SlipMatch = { matchId: string; teamA: string; teamB: string; logoA: string | null; logoB: string | null; bestOf: 1 | 3 | 5; block: string; aiPool: Record<string, number> };
export type Slip = { match: SlipMatch; market: Market; choice: string };

type FanState = {
  me: Me | null;
  open: Record<string, OpenSeries>;
  ready: boolean;
  available: number;
  slip: Slip | null;
  openSlip(s: Slip): void;
  closeSlip(): void;
  placeBet(matchId: string, market: Market, choice: string, stake: number): Promise<boolean>;
  signIn(): void;
  signOut(): Promise<void>;
  /** Cancels one buy before lock; true when its AXP is back in the balance. */
  cancelBuy(buyId: number): Promise<boolean>;
  /** Claims a settled win; true when the payout joined the balance. */
  claim(matchId: string): Promise<boolean>;
  /** Sets your favourite role and/or photo (a data URL, or null to remove it). */
  updateProfile(patch: { favRole?: string | null; image?: string | null; favChamps?: string[]; nickname?: string | null }): Promise<boolean>;
};

export const AXP_START = 10_000;
const Ctx = createContext<FanState | null>(null);
export const useFans = () => useContext(Ctx)!;

const SignInDialog = dynamic(() => import("./SignInDialog"), { ssr: false });
const BetSlip = dynamic(() => import("./BetSlip"), { ssr: false });

async function api<T>(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" }, credentials: "same-origin" });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T & { error?: string } };
}

export default function FanProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState<Record<string, OpenSeries>>({});
  const [ready, setReady] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [slip, setSlip] = useState<Slip | null>(null);
  const say = useCallback((msg: string, kind: "ok" | "error" = "ok") => (kind === "error" ? toast.error(msg) : toast.success(msg)), []);

  const refresh = useCallback(async () => {
    const [m, p] = await Promise.all([api<Me>("/api/me"), api<{ series: OpenSeries[] }>("/api/picks")]);
    setMe(m.ok && m.body && (m.body as Me).address ? m.body : null);
    if (p.ok) setOpen(Object.fromEntries(p.body.series.map((s) => [s.series.matchId, s])));
    setReady(true);
    return m.ok && m.body && (m.body as Me).address ? m.body : null;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openSlip = useCallback((s: Slip) => (me ? setSlip(s) : setDialog(true)), [me]);

  const placeBet = useCallback(
    async (matchId: string, market: Market, choice: string, stake: number) => {
      const r = await api("/api/picks", { method: "POST", body: JSON.stringify({ matchId, market, choice, stake }) });
      if (!r.ok) {
        say(r.body.error ?? "That bet couldn't be placed. Please try again.", "error");
        return false;
      }
      say(`Bought ${stake.toLocaleString("en-US")} AXP of ${choice}`);
      await refresh();
      return true;
    },
    [refresh, say],
  );

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.google?.accounts?.id.disableAutoSelect();
    setMe(null);
    setSlip(null);
    await refresh();
  }, [refresh]);

  const updateProfile = useCallback(
    async (patch: { favRole?: string | null; image?: string | null; favChamps?: string[]; nickname?: string | null }) => {
      const r = await api<{ favRole?: string | null; avatarUrl?: string | null; favChamps?: string[]; nickname?: string | null; displayName?: string }>("/api/me", { method: "POST", body: JSON.stringify(patch) });
      if (!r.ok) {
        say(r.body.error ?? "That didn't save. Please try again.", "error");
        return false;
      }
      setMe((m) => (m ? { ...m, ...r.body } : m));
      return true;
    },
    [say],
  );

  const claim = useCallback(
    async (matchId: string) => {
      const r = await api<{ claimed: number }>("/api/claim", { method: "POST", body: JSON.stringify({ matchId }) });
      if (!r.ok) {
        say(r.body.error ?? "That claim didn't go through. Please try again.", "error");
        return false;
      }
      say(`Claimed ${r.body.claimed.toLocaleString("en-US")} AXP`);
      await refresh();
      return true;
    },
    [refresh, say],
  );

  const cancelBuy = useCallback(
    async (buyId: number) => {
      const r = await api<{ refunded: number }>("/api/cancel", { method: "POST", body: JSON.stringify({ buyId }) });
      if (!r.ok) {
        say(r.body.error ?? "That bet couldn't be cancelled. Please try again.", "error");
        return false;
      }
      say(`Cancelled · ${r.body.refunded.toLocaleString("en-US")} AXP back in your balance`);
      await refresh();
      return true;
    },
    [refresh, say],
  );

  const available = me?.axp?.available ?? AXP_START;

  return (
    <Ctx.Provider value={{ me, open, ready, available, slip, openSlip, closeSlip: () => setSlip(null), placeBet, signIn: () => setDialog(true), signOut, updateProfile, claim, cancelBuy }}>
      {children}
      {dialog && (
        <SignInDialog
          onClose={() => setDialog(false)}
          onSignedIn={async () => {
            setDialog(false);
            const fresh = await refresh();
            const first = fresh && fresh.picks.length === 0;
            say(first ? `Welcome! You've got ${AXP_START.toLocaleString("en-US")} AXP to play with.` : "You're in. Good luck!");
          }}
        />
      )}
      {slip && <BetSlip />}
    </Ctx.Provider>
  );
}
