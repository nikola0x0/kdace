// In-browser verification of one series, straight against Sui's public GraphQL (not KDAce's servers):
// the published picks hash to the fingerprint on chain, the commit landed before the game, the result is on chain,
// the analysts' final-call top-ups (when there were any) are the published ones, on each analyst's own side, and locked
// before the game, and (when signed in) the viewer's own bet is inside the fans' batch.

export type VerifyInput = {
  network: "testnet" | "mainnet";
  packageId: string;
  /** The match id; the final call is committed under `<matchId>:final`. */
  matchId?: string;
  /** The scheduled start as stored at commit time. */
  startTime: string;
  batch: string | null;
  commitDigest: string | null;
  fansBatch: string | null;
  fansDigest: string | null;
  result: { winner: string; score: string; resultDigest: string } | null;
  /** Lessons each analyst recalled, as published: checked against the fingerprinted batch and the pick time. */
  memories?: { player: string; blobId: string; savedAt: string; pickedAt: string }[];
  /** Each analyst's published reasoning and thinking summary: re-hashed and checked against the fingerprinted batch. */
  thoughts?: { player: string; reasoning: string; thinking: string }[];
  /** The analysts' final-call top-ups (committed under `<matchId>:final`), when there were any. */
  finalBatch?: string | null;
  finalDigest?: string | null;
  /** Each published final call: what the analyst added and the side it originally picked. */
  finalCalls?: { player: string; add: number; side: string }[];
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

async function commitChecks(label: string, input: VerifyInput, batch: string, digest: string, marketId?: string): Promise<Check[]> {
  const out: Check[] = [];
  try {
    const { events: evs } = await events(input.network, digest);
    const ev = evs.find((e) => e.type === `${input.packageId}::ledger::BatchCommitted`);
    if (!ev) return [{ label: `${label}: fingerprint on Sui`, ok: false, detail: "no KDAce commit event in that transaction" }];
    const local = await sha256Hex(batch);
    const onchain = b64ToHex(ev.json.batch_hash);
    const wrongMarket = marketId !== undefined && ev.json.market_id !== marketId;
    out.push({ label: `${label}: fingerprint matches`, ok: local === onchain && !wrongMarket, detail: wrongMarket ? `committed under ${ev.json.market_id}, not ${marketId}` : `${local.slice(0, 12)}… ${local === onchain ? "=" : "≠"} on-chain ${onchain.slice(0, 12)}…` });
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
  if (input.finalBatch && input.finalDigest) checks.push(...(await commitChecks("Final call", input, input.finalBatch, input.finalDigest, input.matchId ? `${input.matchId}:final` : undefined)), ...finalCallChecks(input));
  if (input.batch && input.memories?.length) {
    // Which memories each analyst used is inside the fingerprint, so it was fixed before the game.
    const locked = new Set((JSON.parse(input.batch).entries as { player: string; lessons?: string[] }[]).flatMap((e) => (e.lessons ?? []).map((id) => `${e.player}|${id}`)));
    const inBatch = input.memories.every((m) => locked.has(`${m.player}|${m.blobId}`));
    const before = input.memories.every((m) => Date.parse(m.savedAt) < Date.parse(m.pickedAt));
    const n = input.memories.length;
    checks.push({ label: "Memories used are locked in", ok: inBatch, detail: inBatch ? `${n} recalled lesson${n > 1 ? "s" : ""} covered by the fingerprint` : "a recalled lesson isn't in the committed batch" });
    checks.push({ label: "Each memory existed before the pick", ok: before, detail: before ? "every lesson was saved to Walrus Memory before it was used" : "a lesson was saved after the pick" });
  }
  if (input.batch && input.thoughts?.length) {
    const locked = new Map((JSON.parse(input.batch).entries as { player: string; market: string; thought?: string }[]).filter((e) => e.market === "winner" && e.thought).map((e) => [e.player, e.thought!]));
    const results = await Promise.all(input.thoughts.map(async (t) => locked.get(t.player) === (await sha256Hex(JSON.stringify([t.reasoning, t.thinking])))));
    const ok = results.every(Boolean);
    const n = input.thoughts.length;
    checks.push({ label: "Their reasoning is locked in", ok, detail: ok ? `${n} analyst${n > 1 ? "s'" : "'s"} reasoning and thinking match the fingerprint` : "a published reasoning doesn't match what was locked" });
  }
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
      const isVoid = ev?.json.winner === "VOID" && ev?.json.score === "VOID";
      checks.push({ label: "Result on Sui", ok, detail: !ev ? "no result event found" : isVoid ? "Void: no official result, every stake refunded" : `${ev.json.winner} ${ev.json.score}` });
    } catch (e) {
      checks.push({ label: "Result on Sui", ok: false, detail: (e as Error).message });
    }
  } else checks.push({ label: "Result on Sui", ok: null, detail: "posted after the game" });
  return checks;
}

type Entry = { player: string; market: string; choice: string; stake: number };

/** The final-call batch holds exactly the published top-ups, each a winner bet of at least 10 AXP on the analyst's own side. */
function finalCallChecks(input: VerifyInput): Check[] {
  let entries: Entry[] = [];
  let analysts: Entry[] = [];
  try {
    entries = JSON.parse(input.finalBatch!).entries;
    analysts = input.batch ? JSON.parse(input.batch).entries : [];
  } catch {
    return [{ label: "Final call: top-ups match the published calls", ok: false, detail: "the published batch can't be read" }];
  }
  const key = (player: string, side: string, stake: number) => `${player}|${side}|${stake}`;
  const published = (input.finalCalls ?? []).filter((c) => c.add > 0).map((c) => key(c.player, c.side, c.add)).sort();
  const locked = entries.map((e) => key(e.player, e.choice, e.stake)).sort();
  const match = entries.every((e) => e.market === "winner") && JSON.stringify(published) === JSON.stringify(locked);
  const sides = new Map((input.finalCalls ?? []).map((c) => [c.player, c.side]));
  // The original side: the analyst's winner bet in the committed analysts' batch, or its published pick if it staked nothing.
  const sideOf = (player: string) => analysts.find((e) => e.player === player && e.market === "winner")?.choice ?? sides.get(player);
  const ownSide = entries.length > 0 && entries.every((e) => e.market === "winner" && sideOf(e.player) !== undefined && e.choice === sideOf(e.player) && Number.isInteger(e.stake) && e.stake >= 10);
  const total = entries.reduce((n, e) => n + e.stake, 0);
  return [
    { label: "Final call: top-ups match the published calls", ok: match, detail: match ? `${entries.length} top-up${entries.length === 1 ? "" : "s"}, ${total.toLocaleString("en-US")} AXP in all` : "the published calls differ from what was locked" },
    { label: "Final call: every top-up is on the analyst's own side", ok: ownSide, detail: ownSide ? "each analyst only added to the team it picked" : "a top-up isn't on the side that analyst picked" },
  ];
}
