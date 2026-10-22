"use client";
// Sign-in dialog: Google first, any Sui wallet as the alternative. Loaded only when opened (wallets are browser-only).
import { useState } from "react";
import { DAppKitProvider, useCurrentAccount, useCurrentWallet, useDAppKit, useWallets } from "@mysten/dapp-kit-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { dAppKit } from "../fans/dapp-kit";
import GoogleSignIn from "../fans/GoogleSignIn";

type Props = { onClose(): void; onSignedIn(): void };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Body({ onClose, onSignedIn }: Props) {
  const account = useCurrentAccount();
  const wallet = useCurrentWallet();
  const wallets = useWallets();
  const kit = useDAppKit();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function signInWith(address: string) {
    const n = await fetch(`/api/auth/nonce?address=${address}`, { credentials: "same-origin" });
    const nb = await n.json();
    if (!n.ok) throw new Error(nb.error);
    const signed = await kit.signPersonalMessage({ message: new TextEncoder().encode(nb.message), network: nb.network });
    const v = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ bytes: signed.bytes, signature: signed.signature }) });
    if (!v.ok) throw new Error((await v.json().catch(() => ({}))).error);
    onSignedIn();
  }

  async function run(label: string, fn: () => Promise<void>) {
    setError("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || "Sign-in was cancelled or didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  // Connect and sign in one go: pick a wallet, approve in it, sign the sign-in message.
  const connect = (w: (typeof wallets)[number]) =>
    run(w.name, async () => {
      const { accounts } = await kit.connectWallet({ wallet: w });
      if (!accounts[0]) throw new Error("That wallet didn't share an account. Please try again.");
      await signInWith(accounts[0].address);
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dialog gap-3.5 border-border bg-[#0b0b0b] p-6 sm:max-w-[400px]">
        <DialogTitle className="text-xl font-bold tracking-tight">Join the board</DialogTitle>
        <DialogDescription>Everyone starts with 10,000 AXP. Sign in to buy outcomes and race the five AI analysts.</DialogDescription>
        <GoogleSignIn onSignedIn={onSignedIn} onError={setError} />
        <div className="or"><span />or use a Sui wallet<span /></div>

        {account && wallet ? (
          <div className="grid gap-2 rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-3">
              <img src={wallet.icon} alt="" className="size-8 rounded-lg" />
              <div className="grid leading-tight">
                <span className="text-sm font-semibold">{wallet.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{short(account.address)}</span>
              </div>
            </div>
            <button className="btn" disabled={!!busy} onClick={() => run("sign", () => signInWith(account.address))}>{busy === "sign" ? "Check your wallet…" : "Sign in with this wallet"}</button>
            <button className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => kit.disconnectWallet()}>Use another wallet</button>
          </div>
        ) : wallets.length ? (
          <div className="grid gap-2">
            {wallets.map((w) => (
              <button key={w.name} disabled={!!busy} onClick={() => connect(w)} className="flex h-11 items-center gap-3 rounded-[10px] border border-input bg-secondary px-3 text-left text-sm font-semibold transition-colors hover:border-neutral-500 disabled:opacity-50">
                <img src={w.icon} alt="" className="size-6 rounded-md" />
                <span className="flex-1">{w.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{busy === w.name ? "Check your wallet…" : "Connect"}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
            No Sui wallet found in this browser. <a className="text-foreground underline underline-offset-2" href="https://slush.app" target="_blank" rel="noreferrer">Get Slush</a> or sign in with Google.
          </p>
        )}

        {error && <p className="err">{error}</p>}
        <button className="btn ghost sm" onClick={onClose}>Not now</button>
      </DialogContent>
    </Dialog>
  );
}

export default function SignInDialog(props: Props) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <Body {...props} />
    </DAppKitProvider>
  );
}
