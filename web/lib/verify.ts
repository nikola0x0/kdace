// In-browser verification of one series, straight against Sui's public GraphQL (not KDAce's servers):
// the published picks hash to the fingerprint on chain, the commit landed before the game, the result is on chain,
// and (when signed in) the viewer's own bet is inside the fans' batch.

export type VerifyInput = {
  network: "testnet" | "mainnet";
  packageId: string;
  startTime: string;
  batch: string | null;
  commitDigest: string | null;
  fansBatch: string | null;
  fansDigest: string | null;
  result: { winner: string; score: string; resultDigest: string } | null;
  me?: string | null; // fan address
};
export type Check = { label: string; ok: boolean | null; detail: string };

const endpoint = (n: string) => `https://graphql.${n}.sui.io/graphql`;

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64ToHex = (b64: string) => [...atob(b64)].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

type Ev = { type: string; json: Record<string, string> };
async function events(network: string, digest: string): Promise<{ events: Ev[]; timestamp: string | null }> {
  const query = `{ transaction(digest: "${digest}") { effects { timestamp events { nodes { contents { type { repr } json } } } } } }`;
  const res = await fetch(endpoint(network), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  const j = await res.json();
  const fx = j?.data?.transaction?.effects;
  if (!fx) throw new Error("transaction not found on Sui");
  return { timestamp: fx.timestamp ?? null, events: (fx.events?.nodes ?? []).map((n: { contents: { type: { repr: string }; json: Record<string, string> } }) => ({ type: n.contents.type.repr, json: n.contents.json })) };
}

async function commitChecks(label: string, input: VerifyInput, batch: string, digest: string): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const { events: evs } = await events(input.network, digest);
    const ev = evs.find((e) => e.type === `${input.packageId}::ledger::BatchCommitted`);
    if (!ev) return [{ label: `${label}: fingerprint on Sui`, ok: false, detail: "no KDAce commit event in that transaction" }];
    const local = await sha256Hex(batch);
    const onchain = b64ToHex(ev.json.batch_hash);
    out.push({ label: `${label}: fingerprint matches`, ok: local === onchain, detail: `${local.slice(0, 12)}… ${local === onchain ? "=" : "≠"} on-chain ${onchain.slice(0, 12)}…` });
    const at = Number(ev.json.committed_at_ms), start = Date.parse(input.startTime);
    const mins = Math.round((start - at) / 60000);
    out.push({ label: `${label}: locked before the game`, ok: at < start, detail: at < start ? `${mins >= 120 ? `${Math.round(mins / 60)} h` : `${mins} min`} before the start` : "committed after the start" });
  } catch (e) {
    out.push({ label: `${label}: fingerprint on Sui`, ok: false, detail: (e as Error).message });
  }
  return out;
}

export async function verifySeries(input: VerifyInput): Promise<Check[]> {
  const checks: Check[] = [];
  if (input.batch && input.commitDigest) checks.push(...(await commitChecks("Analysts' picks", input, input.batch, input.commitDigest)));
  if (input.fansBatch && input.fansDigest) checks.push(...(await commitChecks("Fans' picks", input, input.fansBatch, input.fansDigest)));
  if (input.me) {
    const entries = input.fansBatch ? (JSON.parse(input.fansBatch).entries as { player: string; choice: string; stake: number }[]) : [];
    const mine = entries.filter((e) => e.player === `fan:${input.me}`);
    checks.push(mine.length
      ? { label: "Your bets are in the batch", ok: true, detail: mine.map((e) => `${e.choice} ${e.stake.toLocaleString("en-US")} AXP`).join(", ") }
      : { label: "Your bets are in the batch", ok: input.fansBatch ? false : null, detail: input.fansBatch ? "no position of yours in this batch" : "fans' batch is committed at lock" });
  }
  if (input.result) {
    try {
      const { events: evs } = await events(input.network, input.result.resultDigest);
      const ev = evs.find((e) => e.type === `${input.packageId}::ledger::ResultPosted`);
      const ok = !!ev && ev.json.winner === input.result.winner && ev.json.score === input.result.score;
      checks.push({ label: "Result on Sui", ok, detail: ev ? `${ev.json.winner} ${ev.json.score}` : "no result event found" });
    } catch (e) {
      checks.push({ label: "Result on Sui", ok: false, detail: (e as Error).message });
    }
  } else checks.push({ label: "Result on Sui", ok: null, detail: "posted after the game" });
  return checks;
}
