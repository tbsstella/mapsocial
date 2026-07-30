/** USD prices for score/asset aggregation. Tries CoinGecko, falls back to statics. */

const FALLBACK_PRICES: Record<string, number> = {
  usd: 1,
  eth: Number(process.env.PRICE_ETH ?? 4000),
  pol: Number(process.env.PRICE_POL ?? 0.4),
  hype: Number(process.env.PRICE_HYPE ?? 40),
};

const COINGECKO_IDS: Record<string, string> = {
  eth: "ethereum",
  pol: "polygon-ecosystem-token",
  hype: "hyperliquid",
};

let cache: { prices: Record<string, number>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getPrices(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.prices;

  const prices = { ...FALLBACK_PRICES };
  try {
    const ids = Object.values(COINGECKO_IDS).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd?: number }>;
      for (const [key, cgId] of Object.entries(COINGECKO_IDS)) {
        const p = data[cgId]?.usd;
        if (typeof p === "number" && p > 0) prices[key] = p;
      }
    }
  } catch {
    // Network unavailable or rate limited: fall back to static prices.
  }
  cache = { prices, fetchedAt: Date.now() };
  return prices;
}
