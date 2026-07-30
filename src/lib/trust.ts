import { createPublicClient, http, formatUnits, erc20Abi } from "viem";
import { APP_CHAINS } from "./chains";
import { getPrices } from "./prices";
import db, { now, blockedByCount, type UserRow } from "./db";

export interface ChainSnapshot {
  key: string;
  label: string;
  txCount: number;
  nativeBalance: number; // in native units
  nativeUsd: number;
  erc20Usd: number;
  totalUsd: number;
  error?: boolean;
}

export interface TrustResult {
  score: number;
  activityScore: number;
  assetScore: number;
  diversityScore: number;
  blockPenalty: number;
  assetsUsd: number;
  chains: ChainSnapshot[];
}

const REFRESH_INTERVAL_S = 24 * 60 * 60;

async function snapshotChain(
  appChain: (typeof APP_CHAINS)[number],
  address: `0x${string}`,
  prices: Record<string, number>
): Promise<ChainSnapshot> {
  const base = {
    key: appChain.key,
    label: appChain.label,
    txCount: 0,
    nativeBalance: 0,
    nativeUsd: 0,
    erc20Usd: 0,
    totalUsd: 0,
  };
  try {
    const client = createPublicClient({
      chain: appChain.chain,
      transport: http(appChain.rpc, { timeout: 8000 }),
    });

    const [txCount, balanceWei] = await Promise.all([
      client.getTransactionCount({ address }),
      client.getBalance({ address }),
    ]);

    let erc20Usd = 0;
    if (appChain.erc20s.length > 0) {
      const balances = await Promise.all(
        appChain.erc20s.map((t) =>
          client
            .readContract({
              address: t.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [address],
            })
            .catch(() => 0n)
        )
      );
      for (let i = 0; i < appChain.erc20s.length; i++) {
        const t = appChain.erc20s[i];
        erc20Usd +=
          Number(formatUnits(balances[i], t.decimals)) * (prices[t.priceId] ?? 0);
      }
    }

    const nativeBalance = Number(formatUnits(balanceWei, 18));
    const nativeUsd = nativeBalance * (prices[appChain.nativePriceId] ?? 0);
    return {
      ...base,
      txCount,
      nativeBalance,
      nativeUsd,
      erc20Usd,
      totalUsd: nativeUsd + erc20Usd,
    };
  } catch {
    return { ...base, error: true };
  }
}

/** Everyone starts here: a brand-new wallet is a neutral 50, not a suspicious 0. */
export const TRUST_BASE = 50;

/**
 * Unified score across all configured EVM chains (0-100).
 * - base      50:     every wallet starts neutral; on-chain history only adds
 * - activity  (0-20): smooth log curve on chain-weighted tx counts (maxes ~1k tx)
 * - assets    (0-18): smooth log curve on unified USD balance (maxes ~$100k),
 *                     no band cliffs — every extra dollar counts a little
 * - diversity (0-12): chains with real usage (tx or balance)
 * - penalty:  progressive per blocker: first block is forgiven lightly (-3),
 *             repeat offenders drop fast (-6 each), capped at -38
 */
export async function computeTrust(address: string): Promise<TrustResult> {
  const prices = await getPrices();
  const addr = address as `0x${string}`;
  const chains = await Promise.all(
    APP_CHAINS.map((c) => snapshotChain(c, addr, prices))
  );

  let weightedTx = 0;
  let activeChains = 0;
  let assetsUsd = 0;
  for (let i = 0; i < chains.length; i++) {
    const snap = chains[i];
    weightedTx += snap.txCount * APP_CHAINS[i].trustWeight;
    if (snap.txCount >= 3 || snap.totalUsd >= 10) activeChains++;
    assetsUsd += snap.totalUsd;
  }

  const activityScore = Math.round(
    20 * Math.min(1, Math.log10(1 + weightedTx) / 3)
  );
  const assetScore = Math.round(
    18 * Math.min(1, Math.log10(1 + Math.max(0, assetsUsd)) / 5)
  );
  const diversityScore = Math.min(12, Math.round(activeChains * 2.4));

  return {
    score: Math.max(
      0,
      Math.min(100, TRUST_BASE + activityScore + assetScore + diversityScore)
    ),
    activityScore,
    assetScore,
    diversityScore,
    blockPenalty: 0, // applied per-user in refreshUserTrust
    assetsUsd,
    chains,
  };
}

/** First block costs little (could be a misunderstanding); repeats cost a lot. */
export function blockPenaltyFor(blockedBy: number): number {
  if (blockedBy <= 0) return 0;
  return Math.min(38, 3 + (blockedBy - 1) * 6);
}

/** Recompute + persist trust/assets for a user if stale (or forced). */
export async function refreshUserTrust(user: UserRow, force = false): Promise<UserRow> {
  const stale =
    !user.trust_updated_at || now() - user.trust_updated_at > REFRESH_INTERVAL_S;
  // Details written by the pre-base-50 formula lack "base": recompute now so
  // nobody is stuck with an old-scale score until the daily refresh.
  const oldFormula = !!user.trust_detail && !user.trust_detail.includes('"base"');
  if (!stale && !force && !oldFormula) return user;

  const result = await computeTrust(user.address);
  const penalty = blockPenaltyFor(blockedByCount(user.id));
  const score = Math.max(0, result.score - penalty);

  db.prepare(
    `UPDATE users SET trust_score = ?, trust_detail = ?, trust_updated_at = ?,
     assets_usd = ?, assets_detail = ?, assets_updated_at = ? WHERE id = ?`
  ).run(
    score,
    JSON.stringify({
      base: TRUST_BASE,
      activity: result.activityScore,
      assets: result.assetScore,
      diversity: result.diversityScore,
      penalty,
    }),
    now(),
    result.assetsUsd,
    JSON.stringify(result.chains),
    now(),
    user.id
  );

  return { ...user, trust_score: score, assets_usd: result.assetsUsd };
}