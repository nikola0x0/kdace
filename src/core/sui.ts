// Sui access through Tatum's gRPC gateway, plus the Referee signer.
import { ChannelCredentials } from "@grpc/grpc-js";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { UnaryCall, type RpcTransport } from "@protobuf-ts/runtime-rpc";
import { tatumGrpcHost, type Network } from "./chain.ts";
import { env } from "./env.ts";

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

/** Tatum's testnet gateway only speaks native gRPC (its JSON-RPC host is mainnet-only). Defaults to the live network. */
export function tatumClient(network = env("SUI_NETWORK") as Network) {
  const transport = new GrpcTransport({
    host: network === process.env.SUI_NETWORK ? (process.env.TATUM_SUI_GRPC ?? tatumGrpcHost(network)) : tatumGrpcHost(network),
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { "x-api-key": env("TATUM_API_KEY") },
  });
  return new SuiGrpcClient({ network, transport: throttled(transport) });
}

/** The Referee signs commits and results; its key is a `suiprivkey1…` string in SUI_REFEREE_KEY. */
export function refereeKeypair() {
  const { scheme, secretKey } = decodeSuiPrivateKey(env("SUI_REFEREE_KEY"));
  if (scheme !== "ED25519") throw new Error(`SUI_REFEREE_KEY must be Ed25519, got ${scheme}`);
  return Ed25519Keypair.fromSecretKey(secretKey);
}
