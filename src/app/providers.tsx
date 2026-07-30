"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, polygon, arbitrum } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { useState } from "react";
import { robinhoodChain, hyperEvm } from "@/lib/chains";
import { I18nProvider } from "@/lib/i18n";

// Browser-side reads (balances, quotes) go through Alchemy when the public
// key is configured; otherwise each chain's default public RPC is used.
const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const rpc = (subdomain: string) =>
  alchemyKey ? http(`https://${subdomain}.g.alchemy.com/v2/${alchemyKey}`) : http();

// WalletConnect lets mobile and non-extension wallets connect via QR code /
// deep link. Free project id: https://cloud.reown.com
// The connector is always registered so the option shows in the login card;
// with the placeholder id the WC SDK only fails on first connect (it is
// created lazily), and the login flow surfaces a clear error for that.
const wcProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "unconfigured";

const wagmiConfig = createConfig({
  chains: [mainnet, polygon, arbitrum, robinhoodChain, hyperEvm],
  connectors: [
    injected(),
    walletConnect({ projectId: wcProjectId, showQrModal: true }),
  ],
  transports: {
    [mainnet.id]: rpc("eth-mainnet"),
    [polygon.id]: rpc("polygon-mainnet"),
    [arbitrum.id]: rpc("arb-mainnet"),
    [robinhoodChain.id]: rpc("robinhood-mainnet"),
    [hyperEvm.id]: rpc("hyperliquid-mainnet"),
  },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>{children}</I18nProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
