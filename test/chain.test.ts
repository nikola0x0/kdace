import { describe, expect, it } from "vitest";
import { chainOf, LEGACY_CHAIN, sameChain, tatumGrpcHost } from "../src/core/chain.ts";

describe("chain", () => {
  it("treats records from before the stamp as the first testnet package", () => {
    expect(chainOf({})).toEqual(LEGACY_CHAIN);
    expect(LEGACY_CHAIN.network).toBe("testnet");
  });

  it("uses a record's own stamp when it has one", () => {
    const chain = { network: "mainnet" as const, packageId: "0xabc" };
    expect(chainOf({ chain })).toEqual(chain);
  });

  it("compares network and package", () => {
    expect(sameChain(LEGACY_CHAIN, { ...LEGACY_CHAIN })).toBe(true);
    expect(sameChain(LEGACY_CHAIN, { network: "mainnet", packageId: LEGACY_CHAIN.packageId })).toBe(false);
  });

  it("names Tatum's gRPC host per network", () => {
    expect(tatumGrpcHost("mainnet")).toBe("sui-mainnet-grpc.gateway.tatum.io:443");
  });
});
