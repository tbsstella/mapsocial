"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet, polygon, arbitrum } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { useState } from "react";
import { robinhoodChain, hyperEvm } from "@/lib/chains";
import { I18nProvider } from "@/lib/i18n";

// Browser-side reads (balances, quotes) go through Alchemy when the public
// key is configured; otherwise each chain's default public RPC is used.
const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const rpc = (subdomain: string) =>
  alchemyKey ? http(`https://${subdomain}.g.alchemy.com/v2/${alchemyKey}`) : http();

const wagmiConfig = createConfig({
  chains: [mainnet, polygon, arbitrum, robinhoodChain, hyperEvm],
  connectors: [injected()],
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
