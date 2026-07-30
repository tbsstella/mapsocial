import { createPublicClient, http, type PublicClient } from "viem";
import { APP_CHAINS } from "./chains";

/**
 * Read-only holder checks for event NFT gates (ERC-721 / ERC-1155).
 * Third-party contracts are untrusted: every call is caught, capped and
 * cached; failures simply mean "not a holder" for that refresh window.
 */

const ERC721_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const ERC1155_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const clients = new Map<string, PublicClient>();

function clientFor(chainKey: string): PublicClient | null {
  const hit = clients.get(chainKey);
  if (hit) return hit;
  const cfg = APP_CHAINS.find((c) => c.key === chainKey);
  if (!cfg) return null;
  const client = createPublicClient({
    chain: cfg.chain,
    transport: http(cfg.rpc, { timeout: 6000 }),
  });
  clients.set(chainKey, client);
  return client;
}

// (eventKey:address) => { at, holder }
const holderCache = new Map<string, { at: number; holder: boolean }>();
const CACHE_TTL_MS = 5 * 60_000;
const MAX_ADDRESSES_PER_CHECK = 200;

export interface NftGate {
  chainKey: string;
  standard: "erc721" | "erc1155";
  contract: `0x${string}`;
  tokenId: string | null; // required for erc1155
}

/** Return the subset of `addresses` currently holding the gate NFT. */
export async function filterHolders(
  gateKey: string,
  gate: NftGate,
  addresses: string[]
): Promise<string[]> {
  const client = clientFor(gate.chainKey);
  if (!client) return [];

  const now = Date.now();
  const holders: string[] = [];
  const toCheck: string[] = [];

  for (const addr of addresses.slice(0, MAX_ADDRESSES_PER_CHECK)) {
    const cached = holderCache.get(`${gateKey}:${addr}`);
    if (cached && now - cached.at < CACHE_TTL_MS) {
      if (cached.holder) holders.push(addr);
    } else {
      toCheck.push(addr);
    }
  }

  const results = await Promise.all(
    toCheck.map(async (addr) => {
      try {
        const balance =
          gate.standard === "erc1155"
            ? await client.readContract({
                address: gate.contract,
                abi: ERC1155_ABI,
                functionName: "balanceOf",
                args: [addr as `0x${string}`, BigInt(gate.tokenId ?? "0")],
              })
            : await client.readContract({
                address: gate.contract,
                abi: ERC721_ABI,
                functionName: "balanceOf",
                args: [addr as `0x${string}`],
              });
        return { addr, holder: balance > 0n };
      } catch {
        return { addr, holder: false };
      }
    })
  );

  for (const r of results) {
    holderCache.set(`${gateKey}:${r.addr}`, { at: now, holder: r.holder });
    if (r.holder) holders.push(r.addr);
  }
  return holders;
}
