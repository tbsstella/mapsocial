"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useSendTransaction,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { erc20Abi, formatUnits, parseUnits, zeroAddress } from "viem";
import { MEME_TOKEN } from "@/lib/chains";
import { apiErrorText, useI18n } from "@/lib/i18n";
import { cropToDataUrl } from "@/lib/avatarupload";
import { copyText } from "@/lib/clipboard";
import { useMe } from "@/hooks/useMe";
import { Avatar, type AvatarKind } from "./Avatar";

export const TIER_ORGANIZER = 1;
export const TIER_BOT = 2;

/** SDK/API docs are hidden from the UI until the SDK is publicly released. */
export const SHOW_SDK = false;

const STAKE_ABI = [
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tier", type: "uint8" },
      { name: "referrer", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface TierStatus {
  ok: boolean;
  slots: number;
  devMode: boolean;
  price: string;
  activeEvents?: number;
}

export interface LicenseInfo {
  contract: `0x${string}` | null;
  minTrust: number;
  inviterAddress: `0x${string}` | null;
  organizer: TierStatus;
  bot: TierStatus;
}

export function useLicense() {
  return useQuery<LicenseInfo>({
    queryKey: ["license"],
    queryFn: async () => (await fetch("/api/license")).json(),
  });
}

export function fmtSimn(wei: string): string {
  return Number(formatUnits(BigInt(wei), MEME_TOKEN.decimals)).toLocaleString();
}

export const SWAP_URL = `https://app.uniswap.org/swap?inputCurrency=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&outputCurrency=${MEME_TOKEN.address}&chain=mainnet`;

/* ----------------------------------------------------------------------
   Built-in swap, driven by the SIMN amount the user needs (exact output).
   The direct pair is USDC/SIMN on Ethereum; when the wallet lacks USDC,
   an extra hop is added automatically and the swap is paid in ETH.
   Quotes come from the Uniswap Trading API (via our server proxy, when
   UNISWAP_API_KEY is configured) or fall back to on-chain Uniswap V2.
   ---------------------------------------------------------------------- */

const UNIV2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" as const;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const USDC_DECIMALS = 6;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
/** ETH kept aside for gas: swapping is pointless if it leaves nothing to pay fees. */
const GAS_RESERVE = parseUnits("0.002", 18);

const SIMN = MEME_TOKEN.address;
const USDC_PATHS: `0x${string}`[][] = [[USDC, SIMN], [USDC, WETH, SIMN]];
const ETH_PATHS: `0x${string}`[][] = [[WETH, USDC, SIMN], [WETH, SIMN]];

const ROUTER_ABI = [
  {
    type: "function",
    name: "getAmountsIn",
    stateMutability: "view",
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapTokensForExactTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "amountInMax", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapETHForExactTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "uint256[]" }],
  },
] as const;

function parseSimnInput(v: string): bigint | null {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  try {
    const units = parseUnits(v, MEME_TOKEN.decimals);
    return units > 0n ? units : null;
  } catch {
    return null;
  }
}

interface PermitData {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  values: Record<string, unknown>;
}

interface LayerQuote {
  layer: "usdc" | "eth";
  mode: "api" | "onchain";
  amountIn: bigint;
  /** on-chain mode: the V2 path used for the quote */
  path?: `0x${string}`[];
  /** api mode: opaque quote object to echo back to /api/swap/build */
  quote?: unknown;
  permitData?: PermitData | null;
}

interface SwapPlan {
  /** the layer the wallet can actually afford (null when neither) */
  chosen: LayerQuote | null;
  /** best available quote, shown even when unaffordable */
  display: LayerQuote;
  insufficient: boolean;
}

type ChainClient = NonNullable<ReturnType<typeof usePublicClient>>;

async function apiLayerQuote(
  tokenIn: "usdc" | "eth",
  simnOut: bigint,
  swapper: string
): Promise<{ onchainFallback: boolean; quote: LayerQuote | null }> {
  const r = await fetch("/api/swap/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amountOut: simnOut.toString(), tokenIn, swapper }),
  });
  const d = await r.json();
  if (d.source === "onchain") return { onchainFallback: true, quote: null };
  if (!d.ok || !/^\d+$/.test(String(d.amountIn)))
    return { onchainFallback: false, quote: null };
  return {
    onchainFallback: false,
    quote: {
      layer: tokenIn,
      mode: "api",
      amountIn: BigInt(d.amountIn),
      quote: d.quote,
      permitData: (d.permitData as PermitData | null) ?? null,
    },
  };
}

async function onchainLayerQuote(
  client: ChainClient,
  layer: "usdc" | "eth",
  simnOut: bigint,
  paths: `0x${string}`[][]
): Promise<LayerQuote | null> {
  for (const path of paths) {
    try {
      const amounts = (await client.readContract({
        address: UNIV2_ROUTER,
        abi: ROUTER_ABI,
        functionName: "getAmountsIn",
        args: [simnOut, path],
      })) as readonly bigint[];
      return { layer, mode: "onchain", amountIn: amounts[0], path };
    } catch {
      // pair missing on this path — try the next layer of hops
    }
  }
  return null;
}

/** Quote both payment layers and pick the first one the wallet can afford:
 *  USDC direct first, then ETH with an extra hop through USDC. */
async function planSwap(
  client: ChainClient,
  simnOut: bigint,
  swapper: string,
  usdcBal: bigint,
  ethBal: bigint
): Promise<SwapPlan> {
  let usdcQ: LayerQuote | null;
  let ethQuote: () => Promise<LayerQuote | null>;

  const first = await apiLayerQuote("usdc", simnOut, swapper);
  if (first.onchainFallback) {
    usdcQ = await onchainLayerQuote(client, "usdc", simnOut, USDC_PATHS);
    ethQuote = () => onchainLayerQuote(client, "eth", simnOut, ETH_PATHS);
  } else {
    usdcQ = first.quote;
    ethQuote = async () => (await apiLayerQuote("eth", simnOut, swapper)).quote;
  }

  if (usdcQ && usdcQ.amountIn <= usdcBal && ethBal >= GAS_RESERVE)
    return { chosen: usdcQ, display: usdcQ, insufficient: false };

  const ethQ = await ethQuote();
  if (ethQ && ethQ.amountIn + GAS_RESERVE <= ethBal)
    return { chosen: ethQ, display: ethQ, insufficient: false };

  const display = usdcQ ?? ethQ;
  if (!display) throw new Error("NO_ROUTE");
  return { chosen: null, display, insufficient: true };
}

function fmtIn(q: LayerQuote): string {
  return q.layer === "usdc"
    ? Number(formatUnits(q.amountIn, USDC_DECIMALS)).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })
    : Number(formatUnits(q.amountIn, 18)).toLocaleString(undefined, {
        maximumSignificantDigits: 4,
      });
}

function SwapCard({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { me } = useMe();
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient({ chainId: MEME_TOKEN.chainId });

  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<"idle" | "wallet" | "chain">("idle");
  const [error, setError] = useState<string | null>(null);

  // Balances and quotes are plain reads: the SIWE address keeps them working
  // even when the wagmi connection dropped (e.g. wallet in-app browsers).
  const addr = (address ?? me?.user?.address) as `0x${string}` | undefined;

  const { data: usdcBalance } = useReadContract({
    abi: erc20Abi,
    address: USDC,
    chainId: MEME_TOKEN.chainId,
    functionName: "balanceOf",
    args: addr ? [addr] : undefined,
    query: { enabled: !!addr, refetchInterval: 30_000 },
  });
  const { data: ethBalance } = useBalance({ address: addr, chainId: MEME_TOKEN.chainId });

  const simnOut = parseSimnInput(amount);
  const ready =
    !!simnOut && !!addr && usdcBalance != null && ethBalance != null && !!publicClient;

  const { data: plan, isError: quoteError } = useQuery({
    queryKey: ["swapPlan", simnOut?.toString(), addr],
    enabled: ready,
    retry: false,
    refetchInterval: 30_000,
    queryFn: () =>
      planSwap(publicClient!, simnOut!, addr!, usdcBalance!, ethBalance!.value),
  });

  async function waitFor(hash: `0x${string}`) {
    setPhase("chain");
    await publicClient?.waitForTransactionReceipt({ hash });
  }

  async function swapViaApi(q: LayerQuote) {
    if (!address || !publicClient) return;
    let signature: `0x${string}` | undefined;
    if (q.layer === "usdc") {
      // Permit2 needs a one-time USDC allowance before signatures work.
      const allowance = await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, PERMIT2],
      });
      if (allowance < q.amountIn) {
        setPhase("wallet");
        const h = await writeContractAsync({
          chainId: MEME_TOKEN.chainId,
          address: USDC,
          abi: erc20Abi,
          functionName: "approve",
          args: [PERMIT2, 2n ** 256n - 1n],
        });
        await waitFor(h);
      }
      if (q.permitData) {
        setPhase("wallet");
        const pd = q.permitData;
        const primaryType =
          Object.keys(pd.types).find((k) => k !== "EIP712Domain") ?? "PermitSingle";
        signature = await signTypedDataAsync({
          domain: pd.domain,
          types: pd.types,
          primaryType,
          message: pd.values,
        } as Parameters<typeof signTypedDataAsync>[0]);
      }
    }
    const r = await fetch("/api/swap/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quote: q.quote, permitData: q.permitData ?? undefined, signature }),
    });
    const tx = await r.json();
    if (!r.ok) throw new Error("BUILD_FAILED");
    setPhase("wallet");
    const hash = await sendTransactionAsync({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: BigInt(tx.value ?? 0),
      chainId: MEME_TOKEN.chainId,
    });
    await waitFor(hash);
  }

  async function swapOnchain(q: LayerQuote) {
    if (!address || !simnOut || !q.path) return;
    const maxIn = (q.amountIn * 102n) / 100n; // 2% slippage guard, excess refunded
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    if (q.layer === "usdc") {
      setPhase("wallet");
      const a = await writeContractAsync({
        chainId: MEME_TOKEN.chainId,
        address: USDC,
        abi: erc20Abi,
        functionName: "approve",
        args: [UNIV2_ROUTER, maxIn],
      });
      await waitFor(a);
      setPhase("wallet");
      const h = await writeContractAsync({
        chainId: MEME_TOKEN.chainId,
        address: UNIV2_ROUTER,
        abi: ROUTER_ABI,
        functionName: "swapTokensForExactTokens",
        args: [simnOut, maxIn, q.path, address, deadline],
      });
      await waitFor(h);
    } else {
      setPhase("wallet");
      const h = await writeContractAsync({
        chainId: MEME_TOKEN.chainId,
        address: UNIV2_ROUTER,
        abi: ROUTER_ABI,
        functionName: "swapETHForExactTokens",
        args: [simnOut, q.path, address, deadline],
        value: maxIn,
      });
      await waitFor(h);
    }
  }

  async function swap() {
    const q = plan?.chosen;
    if (!q) return;
    setError(null);
    try {
      if (chainId !== MEME_TOKEN.chainId) {
        await switchChainAsync({ chainId: MEME_TOKEN.chainId });
      }
      if (q.mode === "api") await swapViaApi(q);
      else await swapOnchain(q);
      setAmount("");
      onDone();
    } catch {
      setError(t("swap.failed"));
    } finally {
      setPhase("idle");
    }
  }

  const busyText =
    phase === "wallet" ? t("tip.confirmWallet") : phase === "chain" ? t("tip.pending") : null;

  return (
    <div className="mt-3 border-t border-white/[0.07] pt-3">
      <div className="flex items-center gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder={t("swap.ph")}
          className="field min-w-0 flex-1 !rounded-full !py-2 !text-xs"
        />
        <button
          onClick={swap}
          disabled={phase !== "idle" || !plan?.chosen}
          className="pressable shrink-0 rounded-full bg-gradient-to-r from-pink-500 to-violet-500 px-4 py-2 text-xs font-bold text-white shadow-[0_4px_16px_rgba(236,72,153,0.35)] hover:brightness-110 disabled:opacity-50"
        >
          {busyText ?? t("create.swap")}
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        {[500, 1000, 2000].map((n) => (
          <button
            key={n}
            onClick={() => setAmount(String(n))}
            className="pressable rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-white/10"
          >
            {n.toLocaleString()}
          </button>
        ))}
        {usdcBalance != null && ethBalance != null && (
          <span className="ml-auto text-[10px] tabular-nums text-slate-500">
            USDC {Number(formatUnits(usdcBalance, USDC_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            {" · "}
            ETH {Number(formatUnits(ethBalance.value, 18)).toLocaleString(undefined, { maximumSignificantDigits: 3 })}
          </span>
        )}
      </div>
      {plan && (
        <p className="mt-1.5 text-[11px] tabular-nums text-slate-400">
          {plan.display.layer === "eth" && (
            <span className="text-amber-300">{t("swap.viaEth")} · </span>
          )}
          {t("swap.need", {
            n: fmtIn(plan.display),
            sym: plan.display.layer === "usdc" ? "USDC" : "ETH",
          })}
        </p>
      )}
      {plan?.insufficient && (
        <p className="mt-1.5 text-[11px] text-red-400">{t("swap.noFunds")}</p>
      )}
      {simnOut && quoteError && (
        <p className="mt-1.5 text-[11px] text-amber-300">
          <a href={SWAP_URL} target="_blank" rel="noopener noreferrer" className="underline">
            {t("swap.uniswap")}
          </a>
        </p>
      )}
      {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

/** SIMN balance + built-in swap; lives in the profile sheet (under the vibes
 *  score) and in the creator panels. */
export function SimnRow({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { t } = useI18n();
  const { me } = useMe();
  const { address } = useAccount();
  const [swapOpen, setSwapOpen] = useState(defaultOpen);
  const addr = (address ?? me?.user?.address) as `0x${string}` | undefined;
  const { data: balance, refetch } = useReadContract({
    abi: erc20Abi,
    address: MEME_TOKEN.address,
    chainId: MEME_TOKEN.chainId,
    functionName: "balanceOf",
    args: addr ? [addr] : undefined,
    query: { enabled: !!addr, refetchInterval: 30_000 },
  });

  return (
    <div className="inset-group px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] text-slate-400">{t("create.balance")}</div>
          <div className="num-glow text-lg font-bold tabular-nums">
            {balance != null
              ? Number(formatUnits(balance, MEME_TOKEN.decimals)).toLocaleString()
              : "—"}{" "}
            <span className="text-xs text-slate-500">{MEME_TOKEN.symbol}</span>
          </div>
        </div>
        <button
          onClick={() => setSwapOpen((v) => !v)}
          className="pressable rounded-full bg-gradient-to-r from-pink-500 to-violet-500 px-4 py-2 text-xs font-bold text-white shadow-[0_4px_16px_rgba(236,72,153,0.35)] hover:brightness-110"
        >
          {swapOpen ? "− " : ""}
          {t("create.swap")}
        </button>
      </div>
      {swapOpen && <SwapCard onDone={() => refetch()} />}
    </div>
  );
}

/** License status + approve/stake flow for one tier. */
export function StakeCard({
  tier,
  status,
  contract,
  referrer,
  heading,
  hint,
}: {
  tier: number;
  status: TierStatus;
  contract: `0x${string}` | null;
  referrer: `0x${string}` | null;
  heading: string;
  hint: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: MEME_TOKEN.chainId });

  const [phase, setPhase] = useState<"idle" | "wallet" | "chain">("idle");
  const [error, setError] = useState<string | null>(null);

  const { data: balance } = useReadContract({
    abi: erc20Abi,
    address: MEME_TOKEN.address,
    chainId: MEME_TOKEN.chainId,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  async function stake() {
    if (!contract) return;
    setError(null);
    const wei = BigInt(status.price);
    if (balance != null && wei > balance) {
      setError(t("create.insufficient"));
      return;
    }
    try {
      if (chainId !== MEME_TOKEN.chainId) {
        await switchChainAsync({ chainId: MEME_TOKEN.chainId });
      }
      setPhase("wallet");
      const approveHash = await writeContractAsync({
        chainId: MEME_TOKEN.chainId,
        address: MEME_TOKEN.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [contract, wei],
      });
      setPhase("chain");
      await publicClient?.waitForTransactionReceipt({ hash: approveHash });
      setPhase("wallet");
      const stakeHash = await writeContractAsync({
        chainId: MEME_TOKEN.chainId,
        address: contract,
        abi: STAKE_ABI,
        functionName: "stake",
        args: [tier, referrer ?? zeroAddress],
      });
      setPhase("chain");
      await publicClient?.waitForTransactionReceipt({ hash: stakeHash });
      queryClient.invalidateQueries({ queryKey: ["license"] });
    } catch {
      setError(t("create.failed"));
    } finally {
      setPhase("idle");
    }
  }

  const busyText =
    phase === "wallet" ? t("tip.confirmWallet") : phase === "chain" ? t("tip.pending") : null;

  return (
    <div className="inset-group p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">{heading}</span>
        {status.ok ? (
          <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
            {t("create.licensed", { n: status.slots })}
          </span>
        ) : (
          <span className="rounded-full bg-white/[0.07] px-2.5 py-0.5 text-[10px] font-bold text-slate-400">
            {t("create.stakeLine", { n: fmtSimn(status.price) })}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{hint}</p>

      {status.devMode && (
        <p className="mt-2 rounded-xl bg-amber-400/10 px-3 py-1.5 text-[10px] text-amber-300">
          {t("create.devMode")}
        </p>
      )}

      {!status.ok && !status.devMode && (
        <button
          onClick={stake}
          disabled={phase !== "idle"}
          className="btn-primary mt-3 w-full py-2.5 text-xs"
        >
          {busyText ?? t("create.stake", { n: fmtSimn(status.price) })}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** In-panel avatar replacement with a role-shaped preview: organizers show
 *  as rounded squares, bots as circles with an AI badge. Upload reuses the
 *  same crop + moderation pipeline as the profile form. */
export function AvatarUploader({ kind }: { kind: AvatarKind }) {
  const { t } = useI18n();
  const { me, invalidate } = useMe();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p = me?.profile;
  if (!p) return null;

  async function upload(file: File) {
    if (!p) return;
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await cropToDataUrl(file);
      const up = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dataUrl }),
      });
      const upData = await up.json();
      if (!up.ok) throw new Error(apiErrorText(upData, t));
      const save = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: p.username,
          avatar: "custom",
          gender: p.gender,
          bio: p.bio,
          link: p.link ?? "",
          profileVisibility: p.profile_visibility,
          genderVisibility: p.gender_visibility,
          assetsVisibility: p.assets_visibility,
          locationMode: p.location_mode,
          messagingAllowed: p.messaging_allowed === 1,
          lat: p.lat,
          lng: p.lng,
        }),
      });
      const saveData = await save.json();
      if (!save.ok) throw new Error(apiErrorText(saveData, t));
      invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("form.uploadFail"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="inset-group flex items-center gap-3 px-4 py-3">
      <Avatar id={p.avatar} url={p.avatar_url} size={44} kind={kind} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-300">{t("form.avatar")}</p>
        {error && <p className="mt-0.5 text-[11px] text-red-400">{error}</p>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="pressable shrink-0 rounded-full border border-white/15 bg-white/[0.05] px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
      >
        {busy ? t("form.uploading") : t("form.uploadAvatar")}
      </button>
    </div>
  );
}

/** Compact machine-readable API cheat-sheet with a "copy for AI" button, so
 *  operators can paste the integration contract straight into their agent. */
export function ApiDocCard({ title, hint, doc }: { title: string; hint: string; doc: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="inset-group p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold">{title}</span>
        <button
          onClick={() => {
            copyText(doc);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="pressable rounded-full border border-white/15 bg-white/[0.05] px-3 py-1 text-[10px] font-semibold text-slate-200 hover:bg-white/10"
        >
          {copied ? t("common.copied") : t("create.copyForAi")}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{hint}</p>
      <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-slate-300">
        {doc}
      </pre>
    </div>
  );
}

/** Shared sheet chrome: right-side panel with title/subtitle + back/close. */
export function CreatePanelShell({
  title,
  subtitle,
  onBack,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="glass-strong sheet-right absolute bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 top-[72px] z-20 flex w-[min(336px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] text-slate-100">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          {onBack && (
            <button onClick={onBack} className="icon-btn shrink-0" aria-label="Back">
              ‹
            </button>
          )}
          <div className="min-w-0">
            <span className="block truncate text-[17px] font-bold tracking-tight">
              {title}
            </span>
            {subtitle && (
              <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{subtitle}</div>
            )}
          </div>
        </div>
        <button onClick={onClose} className="icon-btn shrink-0" aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-1">
        {children}
      </div>
    </div>
  );
}
