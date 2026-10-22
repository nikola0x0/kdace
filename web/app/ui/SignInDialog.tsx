"use client";
// Sign-in dialog: Google first, any Sui wallet as the alternative. Loaded only when opened (wallets are browser-only).
import { useState } from "react";
import { DAppKitProvider, useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { dAppKit } from "../fans/dapp-kit";
import GoogleSignIn from "../fans/GoogleSignIn";

type Props = { onClose(): void; onSignedIn(): void };

function Body({ onClose, onSignedIn }: Props) {
  const account = useCurrentAccount();
  const kit = useDAppKit();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function walletSignIn() {
    if (!account) return;
    setError("");
    setBusy(true);
    try {
      const n = await fetch(`/api/auth/nonce?address=${account.address}`, { credentials: "same-origin" });
      const nb = await n.json();
      if (!n.ok) throw new Error(nb.error);
      const signed = await kit.signPersonalMessage({ message: new TextEncoder().encode(nb.message), network: nb.network });
      const v = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ bytes: signed.bytes, signature: signed.signature }) });
      if (!v.ok) throw new Error((await v.json().catch(() => ({}))).error);
      onSignedIn();
    } catch (e) {
      setError((e as Error).message || "Sign-in was cancelled or didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="signin-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="signin-title">Join the board</h3>
        <p>Picks are free. Sign in to call every match and race the five AI analysts for points.</p>
        <GoogleSignIn onSignedIn={onSignedIn} onError={setError} />
        <div className="or"><span />or<span /></div>
        {account ? (
          <button className="btn ghost" disabled={busy} onClick={walletSignIn}>{busy ? "Check your wallet…" : "Continue with this wallet"}</button>
        ) : (
          <ConnectButton>Use a crypto wallet instead</ConnectButton>
        )}
        {error && <p className="err">{error}</p>}
        <button className="btn ghost sm" onClick={onClose}>Not now</button>
      </div>
    </div>
  );
}

export default function SignInDialog(props: Props) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <Body {...props} />
    </DAppKitProvider>
  );
}
