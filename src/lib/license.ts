import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { MEME_TOKEN, rpcUrl } from "./chains";

export { MEME_TOKEN };

/**
 * License permissions backed by the LicenseStake contract on Ethereum
 * (the chain where the SIMN meme token lives).
 *
 * Tiers: 1 = event organizer, 2 = bot operator.
 * One active position = one concurrent event slot / one bot key.
 *
 * Until LICENSE_STAKE_CONTRACT is set (contract not deployed yet), license
 * checks pass in dev mode so the events flow can be built and tested.
 */

export const TIER_ORGANIZER = 1;
export const TIER_BOT = 2;

const LICENSE_ABI = [
  {
    type: "function",
    name: "activeCount",
    stateMutability: "view",
    inputs: [
      { name: "beneficiary", type: "address" },
      { name: "tier", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "stakePrice",
    stateMutability: "view",
    inputs: [{ name: "tier", type: "uint8" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const contractAddress = process.env.LICENSE_STAKE_CONTRACT as `0x${string}` | undefined;

/** Deployed LicenseStake address, or null in dev mode. */
export function licenseContract(): `0x${string}` | null {
  return contractAddress ?? null;
}

/** Product defaults (Mode A: fixed token amounts) used before deployment. */
const DEFAULT_PRICES: Record<number, bigint> = {
  [1]: 2000n * 10n ** 18n, // organizer
  [2]: 1000n * 10n ** 18n, // bot operator
};

const client = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl("ethereum"), { timeout: 8000 }),
});

export interface LicenseStatus {
  ok: boolean;
  /** Number of active positions of this tier (= concurrent slots). */
  slots: number;
  /** True when the contract is not configured and dev fallback applied. */
  devMode: boolean;
}

const cache = new Map<string, { at: number; status: LicenseStatus }>();
const CACHE_TTL_MS = 60_000;

/** Check how many active license positions an address holds for a tier. */
export async function checkLicense(address: string, tier: number): Promise<LicenseStatus> {
  if (!contractAddress) {
    return { ok: true, slots: 1, devMode: true };
  }
  const key = `${address.toLowerCase()}:${tier}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.status;

  try {
    const count = await client.readContract({
      address: contractAddress,
      abi: LICENSE_ABI,
      functionName: "activeCount",
      args: [address as `0x${string}`, tier],
    });
    const slots = Number(count);
    const status: LicenseStatus = { ok: slots > 0, slots, devMode: false };
    cache.set(key, { at: Date.now(), status });
    return status;
  } catch {
    // RPC failure: fail closed for writes, but keep any cached value.
    return hit?.status ?? { ok: false, slots: 0, devMode: false };
  }
}

/** Trust-score floor for organizers (the safety valve when SIMN price dips). */
export function organizerMinTrust(): number {
  return Number(process.env.EVENT_MIN_TRUST ?? 0);
}

/** Current stake price for a tier (wei). Contract generation pricing wins;
 *  falls back to the product defaults before deployment. */
export async function stakePrice(tier: number): Promise<bigint> {
  if (!contractAddress) return DEFAULT_PRICES[tier] ?? 0n;
  try {
    return await client.readContract({
      address: contractAddress,
      abi: LICENSE_ABI,
      functionName: "stakePrice",
      args: [tier],
    });
  } catch {
    return DEFAULT_PRICES[tier] ?? 0n;
  }
}
