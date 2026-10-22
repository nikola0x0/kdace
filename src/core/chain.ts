// Which Sui network and ledger package a record was committed on. Dependency-free so the web page can import it.
export type Network = "testnet" | "mainnet";
export type Chain = { network: Network; packageId: string };

/** Records committed before the stamp existed all went to the first testnet package. */
export const LEGACY_CHAIN: Chain = { network: "testnet", packageId: "0x3ed6ca261704df0b8f3cfef3e81d1bdfc73726ab759da673dada1032fca21481" };

export const chainOf = (r: { chain?: Chain }): Chain => r.chain ?? LEGACY_CHAIN;

export const sameChain = (a: Chain, b: Chain) => a.network === b.network && a.packageId === b.packageId;

export const tatumGrpcHost = (network: Network) => `sui-${network}-grpc.gateway.tatum.io:443`;
