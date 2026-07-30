"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { Avatar, avatarKind } from "./Avatar";
import { TrustBadge } from "./TrustBadge";
import { MEME_TOKEN } from "@/lib/chains";
import { apiErrorText, useI18n } from "@/lib/i18n";

export interface ThreadSummary {
  id: number;
  other: {
    address: string;
    username: string | null;
    avatar: string;
    avatarUrl: string | null;
    accountType: string;
    isOrganizer?: boolean;
    gender?: string | null;
  };
  lastMessage: { body: string; fromMe: boolean; at: number } | null;
}

interface ChatMessage {
  id: number;
  fromMe: boolean;
  body: string;
  at: number;
  kind: string;
  tipAmount: string | null;
  tipTx: string | null;
}

interface ThreadDetail {
  id: number;
  other: {
    address: string;
    username: string | null;
    avatar: string;
    avatarUrl: string | null;
    accountType: string;
    isOrganizer?: boolean;
    gender?: string | null;
    trustScore: number;
  };
  messages: ChatMessage[];
  blockedByMe: boolean;
  canSend: boolean;
  awaitingReply: boolean;
}

/** Threads list panel (contacts), shown as a card under the top bar. */
export function ThreadsPanel({
  onOpenChat,
  onClose,
}: {
  onOpenChat: (threadId: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data } = useQuery<{ threads: ThreadSummary[] }>({
    queryKey: ["threads"],
    queryFn: async () => (await fetch("/api/threads")).json(),
    refetchInterval: 10_000,
  });

  return (
    <div className="glass-strong sheet-right absolute bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 top-[72px] z-20 flex w-[min(336px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] text-slate-100">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <span className="text-[17px] font-bold tracking-tight">{t("threads.title")}</span>
        <button onClick={onClose} className="icon-btn" aria-label={t("common.close")}>
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {(data?.threads ?? []).length === 0 && (
          <p className="px-3 py-2 text-xs text-slate-400">{t("threads.empty")}</p>
        )}
        {(data?.threads ?? []).map((th) => (
          <button
            key={th.id}
            onClick={() => onOpenChat(th.id)}
            className="pressable flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.06]"
          >
            <Avatar
              id={th.other.avatar}
              url={th.other.avatarUrl}
              size={40}
              kind={avatarKind(th.other.accountType, th.other.isOrganizer)}
              gender={th.other.gender}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[14px] font-semibold">
                <span className="truncate">{th.other.username ?? t("common.notSet")}</span>
                {th.other.accountType === "bot" && (
                  <span className="rounded-md bg-white/10 px-1.5 py-px text-[9px] font-bold text-slate-300">
                    BOT
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-400">
                {th.lastMessage
                  ? `${th.lastMessage.fromMe ? t("threads.me") : ""}${th.lastMessage.body}`
                  : ""}
              </div>
            </div>
            <span className="text-slate-600">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Inline SIMN tip flow: wallet-to-wallet ERC-20 transfer on Ethereum,
 *  then the tx hash is submitted for on-chain verification and recording. */
function TipPanel({
  threadId,
  toAddress,
  onClose,
}: {
  threadId: number;
  toAddress: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: MEME_TOKEN.chainId });

  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<"idle" | "wallet" | "chain" | "record">("idle");
  const [error, setError] = useState<string | null>(null);

  const { data: balance } = useReadContract({
    abi: erc20Abi,
    address: MEME_TOKEN.address,
    chainId: MEME_TOKEN.chainId,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  async function sendTip() {
    setError(null);
    let wei: bigint;
    try {
      wei = parseUnits(amount, MEME_TOKEN.decimals);
    } catch {
      setError(t("tip.failed"));
      return;
    }
    if (wei <= 0n) {
      setError(t("tip.failed"));
      return;
    }
    if (balance != null && wei > balance) {
      setError(t("tip.insufficient"));
      return;
    }
    try {
      if (chainId !== MEME_TOKEN.chainId) {
        await switchChainAsync({ chainId: MEME_TOKEN.chainId });
      }
      setPhase("wallet");
      const hash = await writeContractAsync({
        chainId: MEME_TOKEN.chainId,
        address: MEME_TOKEN.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [toAddress as `0x${string}`, wei],
      });
      setPhase("chain");
      await publicClient?.waitForTransactionReceipt({ hash });
      setPhase("record");
      const res = await fetch(`/api/threads/${threadId}/tip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(apiErrorText(data, t));
        setPhase("idle");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
      queryClient.invalidateQueries({ queryKey: ["threads"] });
      onClose();
    } catch {
      setError(t("tip.failed"));
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const phaseText =
    phase === "wallet"
      ? t("tip.confirmWallet")
      : phase === "chain"
        ? t("tip.pending")
        : phase === "record"
          ? t("tip.recording")
          : null;

  return (
    <div className="border-t border-amber-400/20 bg-amber-400/5 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-amber-300">🎁 {t("tip.title")}</span>
        <button
          onClick={onClose}
          className="rounded-full px-1.5 text-slate-500 hover:bg-white/10"
          aria-label={t("common.close")}
        >
          ✕
        </button>
      </div>
      {balance != null && (
        <p className="mt-1 text-[10px] tabular-nums text-slate-400">
          {t("tip.balance", {
            n: Number(formatUnits(balance, MEME_TOKEN.decimals)).toLocaleString(),
          })}
        </p>
      )}
      <div className="mt-1.5 flex gap-1.5">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && sendTip()}
          inputMode="decimal"
          disabled={busy}
          placeholder={t("tip.amountPh")}
          className="min-w-0 flex-1 rounded-full border border-amber-400/25 bg-white/5 px-3.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-amber-400 disabled:opacity-50"
        />
        <button
          onClick={sendTip}
          disabled={busy || !amount.trim()}
          className="pressable shrink-0 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-3.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
        >
          {t("tip.send")}
        </button>
      </div>
      {phaseText && <p className="mt-1 text-[10px] text-amber-300">{phaseText}</p>}
      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

/** A single floating chat window card. */
function ChatCard({
  threadId,
  onClose,
}: {
  threadId: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: thread } = useQuery<ThreadDetail>({
    queryKey: ["thread", threadId],
    queryFn: async () => {
      const res = await fetch(`/api/threads/${threadId}`);
      if (!res.ok) throw new Error(t("err.GENERIC"));
      return res.json();
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length, collapsed]);

  async function send() {
    if (!draft.trim() || !thread) return;
    setSendError(null);
    const res = await fetch(`/api/threads/${threadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSendError(apiErrorText(data, t));
      return;
    }
    setDraft("");
    queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
    queryClient.invalidateQueries({ queryKey: ["threads"] });
  }

  async function toggleBlock() {
    if (!thread) return;
    await fetch(`/api/users/${thread.other.address}/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: thread.blockedByMe ? "unblock" : "block" }),
    });
    queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
  }

  return (
    <div className="glass-strong sheet-up pointer-events-auto flex w-[min(310px,calc(100vw-32px))] flex-col overflow-hidden rounded-[22px] text-slate-100">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center gap-2.5 border-b border-white/[0.07] px-3.5 py-2.5"
        onClick={() => setCollapsed((c) => !c)}
      >
        {thread ? (
          <>
            <Avatar
              id={thread.other.avatar}
              url={thread.other.avatarUrl}
              size={30}
              kind={avatarKind(thread.other.accountType, thread.other.isOrganizer)}
              gender={thread.other.gender}
            />
            <span className="truncate text-[14px] font-bold tracking-tight">
              {thread.other.username ?? t("common.notSet")}
            </span>
            {thread.other.accountType === "bot" && (
              <span className="rounded-md bg-white/10 px-1.5 py-px text-[9px] font-bold text-slate-300">
                BOT
              </span>
            )}
            <TrustBadge score={thread.other.trustScore} />
          </>
        ) : (
          <span className="text-sm text-slate-400">{t("common.loading")}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {thread && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleBlock();
              }}
              className={`pressable rounded-full px-2 py-1 text-[10px] font-bold ${
                thread.blockedByMe
                  ? "bg-white/[0.07] text-slate-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              {thread.blockedByMe ? t("chat.unblock") : t("chat.block")}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="icon-btn"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="flex h-[290px] flex-col gap-1.5 overflow-y-auto bg-black/25 p-3">
            {(thread?.messages ?? []).map((m) =>
              m.kind === "tip" ? (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-[18px] border border-amber-400/35 bg-amber-400/10 px-3.5 py-2 text-sm text-amber-200 ${
                    m.fromMe ? "self-end rounded-br-md" : "self-start rounded-bl-md"
                  }`}
                >
                  <div className="font-semibold">{m.body}</div>
                  {m.tipTx && (
                    <a
                      href={`https://etherscan.io/tx/${m.tipTx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-amber-400/80 underline-offset-2 hover:underline"
                    >
                      {t("tip.viewTx")}
                    </a>
                  )}
                </div>
              ) : (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-[18px] px-3.5 py-2 text-[14px] leading-snug ${
                    m.fromMe
                      ? "self-end rounded-br-[6px] bg-gradient-to-b from-[#5b6cff] to-[#7c5cf6] text-white shadow-[0_2px_10px_rgba(91,108,255,0.3)]"
                      : "self-start rounded-bl-[6px] bg-white/[0.09] text-slate-100"
                  }`}
                >
                  {m.body}
                </div>
              )
            )}
            {thread?.awaitingReply && (
              <p className="self-center rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[10px] text-amber-300">
                {t("chat.awaiting")}
              </p>
            )}
            <div ref={bottomRef} />
          </div>

          {tipOpen && thread && (
            <TipPanel
              threadId={threadId}
              toAddress={thread.other.address}
              onClose={() => setTipOpen(false)}
            />
          )}

          <div className="border-t border-white/[0.07] p-2.5">
            {sendError && <p className="mb-1 px-1 text-[11px] text-red-400">{sendError}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTipOpen((v) => !v)}
                disabled={!thread || thread.blockedByMe}
                title={t("tip.title")}
                aria-label={t("tip.title")}
                className={`pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-base disabled:opacity-40 ${
                  tipOpen
                    ? "border-amber-400/60 bg-amber-400/15"
                    : "border-white/10 bg-white/[0.06]"
                }`}
              >
                🎁
              </button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                disabled={!thread?.canSend}
                placeholder={
                  !thread
                    ? ""
                    : thread.blockedByMe
                      ? t("chat.blockedByYou")
                      : thread.awaitingReply
                        ? t("chat.waitReply")
                        : t("chat.typeMessage")
                }
                className="field min-w-0 flex-1 !rounded-full !py-2"
              />
              <button
                onClick={send}
                disabled={!thread?.canSend || !draft.trim()}
                aria-label={t("common.send")}
                className="btn-primary flex h-9 w-9 shrink-0 items-center justify-center !rounded-full text-base font-bold"
              >
                ↑
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Tab chip for one open conversation; the active one is highlighted. */
function ChatTab({
  threadId,
  active,
  summary,
  onSelect,
  onClose,
}: {
  threadId: number;
  active: boolean;
  summary: ThreadSummary | undefined;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`glass pressable flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full py-1 pl-1 pr-1.5 ${
        active ? "!border-indigo-400/50 !bg-indigo-500/20" : ""
      }`}
      onClick={onSelect}
      role="tab"
      aria-selected={active}
    >
      {summary ? (
        <Avatar
          id={summary.other.avatar}
          url={summary.other.avatarUrl}
          size={22}
          kind={avatarKind(summary.other.accountType, summary.other.isOrganizer)}
          gender={summary.other.gender}
        />
      ) : (
        <span className="w-[22px] text-center text-xs">💬</span>
      )}
      <span
        className={`max-w-[72px] truncate text-[11px] font-semibold ${
          active ? "text-indigo-200" : "text-slate-300"
        }`}
      >
        {summary?.other.username ?? `#${threadId}`}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="rounded-full px-1 text-[10px] text-slate-500 hover:bg-white/10 hover:text-slate-300"
        aria-label={t("common.close")}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Bottom-right chat area: one visible window plus a tab strip of all open
 * conversations, so switching between several chats is a single tap.
 */
export function ChatDock({
  openChats,
  onClose,
  avoidRightPanel = false,
}: {
  openChats: number[];
  onClose: (threadId: number) => void;
  /** Slide left (desktop) while a right-side sheet is open so its buttons stay reachable. */
  avoidRightPanel?: boolean;
}) {
  const [sel, setSel] = useState<number | null>(null);

  // A newly opened chat (appended last by the page) becomes active even if
  // the user had manually selected another tab before.
  const lastId = openChats[openChats.length - 1];
  const [prevLast, setPrevLast] = useState(lastId);
  if (prevLast !== lastId) {
    setPrevLast(lastId);
    setSel(lastId ?? null);
  }

  const { data: threadsData } = useQuery<{ threads: ThreadSummary[] }>({
    queryKey: ["threads"],
    queryFn: async () => (await fetch("/api/threads")).json(),
    enabled: openChats.length > 1,
  });

  if (openChats.length === 0) return null;
  const active = sel != null && openChats.includes(sel) ? sel : lastId;

  return (
    <div
      className={`pointer-events-none absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex max-w-[calc(100vw-16px)] flex-col items-end gap-2 transition-[right] duration-300 ${
        avoidRightPanel ? "right-4 sm:right-[calc(min(336px,100vw-32px)+2rem)]" : "right-4"
      }`}
    >
      {openChats.length > 1 && (
        <div
          className="pointer-events-auto flex max-w-full gap-1.5 overflow-x-auto pb-0.5"
          role="tablist"
        >
          {openChats.map((id) => (
            <ChatTab
              key={id}
              threadId={id}
              active={id === active}
              summary={threadsData?.threads.find((th) => th.id === id)}
              onSelect={() => setSel(id)}
              onClose={() => onClose(id)}
            />
          ))}
        </div>
      )}
      {/* Keep every open chat mounted so drafts and scroll survive switching */}
      {openChats.map((id) => (
        <div key={id} className={id === active ? "" : "hidden"}>
          <ChatCard threadId={id} onClose={() => onClose(id)} />
        </div>
      ))}
    </div>
  );
}
