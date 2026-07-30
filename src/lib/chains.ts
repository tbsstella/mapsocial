import { defineChain, type Chain } from "viem";
import { mainnet, polygon, arbitrum } from "viem/chains";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_ROBINHOOD_RPC ??
          "https://rpc.mainnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const hyperEvm = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_HYPEREVM_RPC ?? "https://rpc.hyperliquid.xyz/evm"],
    },
  },
  blockExplorers: {
    default: { name: "Hyperscan", url: "https://hyperevmscan.io" },
  },
});

export interface Erc20Token {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  priceId: string; // key into the price table
}

export interface AppChain {
  chain: Chain;
  key: string;
  label: string;
  rpc: string;
  /** Weight applied to on-chain activity when computing the unified trust score.
   *  Older, harder-to-farm chains weigh more than brand-new ones. */
  trustWeight: number;
  nativePriceId: string;
  erc20s: Erc20Token[];
}

const USD_STABLE = { priceId: "usd", decimals: 6 };

/** One Alchemy key powers every chain. Server code reads ALCHEMY_API_KEY;
 *  NEXT_PUBLIC_ALCHEMY_API_KEY doubles for the browser (wagmi transports). */
const ALCHEMY_KEY =
  process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "";

export function alchemyRpc(subdomain: string): string | null {
  return ALCHEMY_KEY ? `https://${subdomain}.g.alchemy.com/v2/${ALCHEMY_KEY}` : null;
}

/** Explicit env override → Alchemy (when key configured) → public fallback. */
function pickRpc(override: string | undefined, subdomain: string, fallback: string): string {
  return override ?? alchemyRpc(subdomain) ?? fallback;
}

export const APP_CHAINS: AppChain[] = [
  {
    chain: mainnet,
    key: "ethereum",
    label: "Ethereum",
    rpc: pickRpc(process.env.ETHEREUM_RPC, "eth-mainnet", "https://ethereum-rpc.publicnode.com"),
    trustWeight: 1.0,
    nativePriceId: "eth",
    erc20s: [
      { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", ...USD_STABLE },
      { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", symbol: "USDT", ...USD_STABLE },
    ],
  },
  {
    chain: polygon,
    key: "polygon",
    label: "Polygon",
    rpc: pickRpc(process.env.POLYGON_RPC, "polygon-mainnet", "https://polygon-bor-rpc.publicnode.com"),
    trustWeight: 0.8,
    nativePriceId: "pol",
    erc20s: [
      { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", symbol: "USDC", ...USD_STABLE },
      { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", symbol: "USDT", ...USD_STABLE },
    ],
  },
  {
    chain: arbitrum,
    key: "arbitrum",
    label: "Arbitrum",
    rpc: pickRpc(process.env.ARBITRUM_RPC, "arb-mainnet", "https://arb1.arbitrum.io/rpc"),
    trustWeight: 0.8,
    nativePriceId: "eth",
    erc20s: [
      { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", symbol: "USDC", ...USD_STABLE },
      { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", symbol: "USDT", ...USD_STABLE },
    ],
  },
  {
    chain: robinhoodChain,
    key: "robinhood",
    label: "Robinhood Chain",
    rpc: pickRpc(
      process.env.ROBINHOOD_RPC,
      "robinhood-mainnet",
      "https://rpc.mainnet.chain.robinhood.com"
    ),
    trustWeight: 0.5,
    nativePriceId: "eth",
    erc20s: [],
  },
  {
    chain: hyperEvm,
    key: "hyperevm",
    label: "HyperEVM",
    rpc: pickRpc(process.env.HYPEREVM_RPC, "hyperliquid-mainnet", "https://rpc.hyperliquid.xyz/evm"),
    trustWeight: 0.5,
    nativePriceId: "hype",
    erc20s: [],
  },
];

/** RPC URL for a chain key (respects env override → Alchemy → public). */
export function rpcUrl(key: string): string {
  const c = APP_CHAINS.find((a) => a.key === key);
  if (!c) throw new Error(`unknown chain key: ${key}`);
  return c.rpc;
}

/** Platform meme token (SilMina). Lives on Ethereum mainnet only; used for
 *  license staking and in-chat tips. Safe to import from client code. */
export const MEME_TOKEN = {
  address: "0x2e3f8d10818807fa607be3e2AE53863d8d8F4235" as `0x${string}`,
  symbol: "SIMN",
  decimals: 18,
  chainKey: "ethereum",
  chainId: 1,
} as const;
