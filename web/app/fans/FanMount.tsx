"use client";
// Mount point for the fan pick flow. Wallet detection is browser-only, so the panel never renders on the server.
import dynamic from "next/dynamic";

const FanPanel = dynamic(() => import("./FanPanel"), { ssr: false, loading: () => <p>Loading fan picks…</p> });

export default function FanMount() {
  return <FanPanel />;
}
