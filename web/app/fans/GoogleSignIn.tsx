"use client";
// "Sign in with Google" through Google Identity Services, ID-token flow: Google hands the page a signed ID token
// (the credential), the page posts it to /api/auth/google, and the server verifies it and derives the fan's zkLogin
// address. Renders nothing when NEXT_PUBLIC_GOOGLE_CLIENT_ID isn't set.
import { useEffect, useRef } from "react";

const GSI_SRC = "https://accounts.google.com/gsi/client";
const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

type GsiId = {
  initialize(opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: "popup"; auto_select?: boolean }): void;
  renderButton(el: HTMLElement, opts: { type?: "standard"; theme?: "outline" | "filled_black"; size?: "medium" | "large"; text?: "signin_with" | "continue_with"; shape?: "pill" | "rectangular"; width?: number }): void;
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
        gsi.renderButton(button.current, { type: "standard", theme: "filled_black", size: "large", text: "continue_with", shape: "rectangular", width: Math.min(400, button.current.clientWidth || 352) });
      })
      .catch((e: Error) => callbacks.current.onError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!clientId) return null;
  // Google's own button lives in an iframe we can't restyle (its "Continue as" version puts the G on a white tile).
  // So we draw our own dark button with the official G mark and lay Google's real button, nearly invisible, on top:
  // every click still lands on Google's button and its sign-in popup.
  return (
    <div className="gsi">
      <div className="gsi-face" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        <span>Continue with Google</span>
      </div>
      <div ref={button} className="gsi-real" />
    </div>
  );
}
