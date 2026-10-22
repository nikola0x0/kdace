// One dApp Kit instance: regular Sui wallets (Slush and others) plus Enoki zkLogin wallets ("Sign in with Google")
// when NEXT_PUBLIC_ENOKI_API_KEY and NEXT_PUBLIC_GOOGLE_CLIENT_ID are set. Browser-only.
import { createDAppKit } from "@mysten/dapp-kit-react";
import { enokiWalletsInitializer } from "@mysten/enoki";
import { SuiGrpcClient } from "@mysten/sui/grpc";

const GRPC_URLS = {
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
} as const;

const enokiApiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY;
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export const dAppKit = createDAppKit({
  networks: ["testnet", "mainnet"],
  defaultNetwork: process.env.NEXT_PUBLIC_SUI_NETWORK === "mainnet" ? "mainnet" : "testnet",
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
  walletInitializers:
    enokiApiKey && googleClientId
      ? [enokiWalletsInitializer({ apiKey: enokiApiKey, providers: { google: { clientId: googleClientId } } })]
      : [],
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
