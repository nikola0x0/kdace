"use client";
// "Sign in with Google" through Google Identity Services, ID-token flow: Google hands the page a signed ID token
// (the credential), the page posts it to /api/auth/google, and the server verifies it and derives the fan's zkLogin
// address. Renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID isn't set. Unstyled on purpose.
import { useEffect, useRef } from "react";

const GSI_SRC = "https://accounts.google.com/gsi/client";
const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

type GsiId = {
  initialize(opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: "popup"; auto_select?: boolean }): void;
  renderButton(el: HTMLElement, opts: { type?: "standard"; theme?: "outline"; size?: "medium"; text?: "signin_with" }): void;
  disableAutoSelect(): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GsiId } };
  }
}

let loading: Promise<GsiId> | null = null;
function loadGsi(): Promise<GsiId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  return (loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Sign in with Google couldn't load. Use a crypto wallet instead.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("Sign in with Google couldn't load. Use a crypto wallet instead."));
    };
    document.head.appendChild(s);
  }));
}

/** Call on sign-out so Google doesn't silently sign the fan back in. */
export const googleSignOut = () => window.google?.accounts?.id.disableAutoSelect();

export default function GoogleSignIn({ onSignedIn, onError }: { onSignedIn: () => void; onError: (message: string) => void }) {
  const button = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onSignedIn, onError });
  callbacks.current = { onSignedIn, onError };

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGsi()
      .then((gsi) => {
        if (cancelled || !button.current) return;
        // Deliberately no `nonce`: zkLogin proofs need a token whose nonce commits to a Sui ephemeral key. Without one,
        // the tokens KDAce's server sees can't be turned into zkLogin proofs for the fan's address, by us or anyone
        // who intercepts them. KDAce only needs the address. The credential is posted once and never stored.
        gsi.initialize({
          client_id: clientId,
          ux_mode: "popup",
          callback: async ({ credential }) => {
            try {
              const res = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ idToken: credential }) });
              if (res.ok) return callbacks.current.onSignedIn();
              const body = await res.json().catch(() => ({}));
              callbacks.current.onError(body.error ?? "Google sign-in didn't work. Please try again.");
            } catch (e) {
              callbacks.current.onError("Google sign-in didn't work. Please try again.");
            }
          },
        });
        gsi.renderButton(button.current, { type: "standard", theme: "outline", size: "medium", text: "signin_with" });
      })
      .catch((e: Error) => callbacks.current.onError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!clientId) return null;
  return <div ref={button} />;
}
