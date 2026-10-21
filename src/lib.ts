// Shared helpers for the PoC: Worlds data, Tatum-backed Sui client, Walrus Memory, analyst LLM.
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { MemWal } from "@mysten-incubation/memwal";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { ChannelCredentials } from "@grpc/grpc-js";
import { UnaryCall, type RpcTransport } from "@protobuf-ts/runtime-rpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
};

// ---------- Worlds data (lolesports public API) ----------

export type Series = {
  matchId: string;
  startTime: string;
  block: string;
  bestOf: number;
  teamA: string;
  teamB: string;
  winsA: number;
  winsB: number;
  winner: string;
};

export async function fetchCompletedSeries(): Promise<Series[]> {
  const res = await fetch(
    "https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&leagueId=98767975604431411",
    { headers: { "x-api-key": "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z" } },
  );
  const events = (await res.json()).data.schedule.events as any[];
  return events
    .filter((e) => e.state === "completed" && e.startTime.startsWith("2026"))
    .map((e) => {
      const [a, b] = e.match.teams;
      return {
        matchId: e.match.id,
        startTime: e.startTime,
        block: e.blockName,
        bestOf: e.match.strategy.count,
        teamA: a.code,
        teamB: b.code,
        winsA: a.result.gameWins,
        winsB: b.result.gameWins,
        winner: a.result.outcome === "win" ? a.code : b.code,
      };
    });
}

// ---------- Sui via Tatum gateway ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Tatum's free plan allows 3 requests/second, and building one transaction makes several calls.
 * Space unary calls ~400ms apart and retry on 429 with backoff.
 */
function throttled(inner: GrpcTransport, minGapMs = 400): RpcTransport {
  let next = 0;
  return {
    mergeOptions: (o) => inner.mergeOptions(o),
    unary(method, input, options) {
      const call = async () => {
        for (let attempt = 0; ; attempt++) {
          const wait = Math.max(0, next - Date.now());
          next = Math.max(next, Date.now()) + minGapMs;
          await sleep(wait);
          try {
            const c = inner.unary(method, input, options);
            const [headers, response, status, trailers] = await Promise.all([c.headers, c.response, c.status, c.trailers]);
            return { headers, response, status, trailers };
          } catch (e: any) {
            if (attempt < 6 && /429/.test(String(e?.message))) {
              await sleep(1000 * (attempt + 1));
              continue;
            }
            throw e;
          }
        }
      };
      const p = call();
      return new UnaryCall(method, options.meta ?? {}, input, p.then((r) => r.headers), p.then((r) => r.response), p.then((r) => r.status), p.then((r) => r.trailers));
    },
    serverStreaming: (m, i, o) => inner.serverStreaming(m, i, o),
    clientStreaming: (m, o) => inner.clientStreaming(m, o),
    duplex: (m, o) => inner.duplex(m, o),
  };
}

/** Tatum's testnet gateway only speaks native gRPC (its JSON-RPC host is mainnet-only). */
export function tatumClient() {
  const transport = new GrpcTransport({
    host: env("TATUM_SUI_GRPC"),
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { "x-api-key": env("TATUM_API_KEY") },
  });
  return new SuiGrpcClient({ network: "testnet", transport: throttled(transport) });
}

/** The Referee signer: the Sui CLI's active address (it holds the ResolverCap). */
export function refereeKeypair() {
  const active = execFileSync("sui", ["client", "active-address"]).toString().trim();
  const keystore: string[] = JSON.parse(readFileSync(`${homedir()}/.sui/sui_config/sui.keystore`, "utf8"));
  for (const entry of keystore) {
    const raw = Buffer.from(entry, "base64");
    if (raw[0] !== 0) continue; // Ed25519 only
    const kp = Ed25519Keypair.fromSecretKey(raw.subarray(1));
    if (kp.toSuiAddress() === active) return kp;
  }
  throw new Error(`No Ed25519 key for active address ${active}`);
}

export const sha256Hex = (data: string) => createHash("sha256").update(data).digest("hex");

// ---------- Walrus Memory (mainnet) ----------

export function memory(namespace: string) {
  return MemWal.create({
    key: env("MEMWAL_PRIVATE_KEY"),
    accountId: env("MEMWAL_ACCOUNT_ID"),
    serverUrl: process.env.MEMWAL_SERVER_URL,
    namespace,
  });
}

// ---------- Analyst LLM (Claude Code CLI, headless) ----------

export function askClaude(prompt: string): string {
  return execFileSync("claude", ["-p", "--output-format", "text"], { input: prompt, maxBuffer: 1 << 20 })
    .toString()
    .trim();
}

export function askClaudeJson<T>(prompt: string): T {
  const text = askClaude(prompt);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in analyst reply: ${text}`);
  return JSON.parse(match[0]) as T;
}

