import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { MEME_TOKEN } from "@/lib/chains";

const TRADE_API = "https://trade-api.gateway.uniswap.org/v1";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const NATIVE = "0x0000000000000000000000000000000000000000";

/**
 * EXACT_OUTPUT quote proxy for the built-in SIMN swap: the user says how much
 * SIMN they want, Uniswap's Trading API answers how much USDC (or ETH, as the
 * fallback layer) that costs. The API key stays server-side. Without a key
 * the client falls back to on-chain Uniswap V2 quoting.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user)
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHORIZED" }, { status: 401 });

  const key = process.env.UNISWAP_API_KEY;
  if (!key) return NextResponse.json({ source: "onchain" });

  const b = (await req.json()) as { amountOut?: string; tokenIn?: string; swapper?: string };
  if (!/^\d+$/.test(String(b.amountOut)) || !/^0x[0-9a-fA-F]{40}$/.test(String(b.swapper)))
    return NextResponse.json({ error: "Missing required fields", code: "MISSING_FIELDS" }, { status: 400 });

  const r = await fetch(`${TRADE_API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      type: "EXACT_OUTPUT",
      amount: String(b.amountOut),
      tokenIn: b.tokenIn === "eth" ? NATIVE : USDC,
      tokenInChainId: MEME_TOKEN.chainId,
      tokenOut: MEME_TOKEN.address,
      tokenOutChainId: MEME_TOKEN.chainId,
      swapper: String(b.swapper),
      urgency: "normal",
      // Classic pools only: /swap then always returns a plain transaction any
      // EOA wallet can broadcast (UniswapX orders need smart-wallet support).
      protocols: ["V2", "V3", "V4"],
      routingPreference: "BEST_PRICE",
    }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data?.quote || data.routing !== "CLASSIC")
    return NextResponse.json({ source: "uniswap", ok: false });

  return NextResponse.json({
    source: "uniswap",
    ok: true,
    // input.amount = required tokenIn amount for the requested SIMN output
    amountIn: String(data.quote?.input?.amount ?? ""),
    quote: data.quote,
    routing: data.routing,
    permitData: data.permitData ?? null,
  });
}
