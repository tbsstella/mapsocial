"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Avatar, avatarKind } from "./Avatar";
import { trustColor } from "./TrustBadge";
import { apiErrorText, useI18n, type TKey } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";

interface PublicProfile {
  address: string;
  username: string;
  avatar: string;
  avatarUrl: string | null;
  accountType: string;
  isOrganizer: boolean;
  trustScore: number;
  vpnDetected: boolean;
  bio: string;
  link: string | null;
  gender: string | null;
  assets: { mode: string; usd?: number; digits?: number };
  location: { mode: string; country: string | null };
  canMessage: boolean;
  blockedByMe: boolean;
  isMe: boolean;
}

export function ProfileSheet({
  address,
  onClose,
  onStartChat,
}: {
  address: string;
  onClose: () => void;
  onStartChat: (threadId: number) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: p, error } = useQuery<PublicProfile, Error>({
    queryKey: ["publicProfile", address],
    queryFn: async () => {
      const r = await fetch(`/api/users/${address}`);
      const data = await r.json();
      if (!r.ok) throw new Error(apiErrorText(data, t));
      return data;
    },
  });

  async function sendFirstMessage() {
    if (!draft.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toAddress: address, body: draft }),
      });
      const data = await res.json();
      if (res.status === 409 && data.threadId) {
        onStartChat(data.threadId);
        onClose();
        return;
      }
      if (!res.ok) throw new Error(apiErrorText(data, t));
      onStartChat(data.threadId);
      onClose();
    } catch (e) {
      setSendResult(e instanceof Error ? e.message : t("err.GENERIC"));
    } finally {
      setSending(false);
    }
  }

  async function toggleBlock() {
    if (!p) return;
    const res = await fetch(`/api/users/${address}/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: p.blockedByMe ? "unblock" : "block" }),
    });
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ["publicProfile", address] });
    }
  }

  return (
    // Sits below the top-right Profile button and above the chat dock so
    // neither is ever covered.
    <div className="glass-strong sheet-right absolute bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 top-[72px] z-20 w-[min(336px,calc(100vw-32px))] overflow-y-auto rounded-[26px] p-5 text-slate-100">
      {/* Sticky so the sheet can always be closed without scrolling back up */}
      <div className="sticky top-0 z-10 -mb-7 flex justify-end">
        <button onClick={onClose} className="icon-btn" aria-label={t("common.close")}>
          ✕
        </button>
      </div>

      {error && <p className="mt-8 text-sm text-red-400">{error.message}</p>}
      {!p && !error && <p className="mt-8 text-sm text-slate-400">{t("common.loading")}</p>}

      {p && (
        <div className="flex flex-col gap-4">
          {/* iOS contact-card style header: centered avatar + name */}
          <div className="flex flex-col items-center pt-4 text-center">
            <Avatar
              id={p.avatar}
              url={p.avatarUrl}
              size={84}
              ring
              kind={avatarKind(p.accountType, p.isOrganizer)}
              gender={p.gender}
            />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <span className="text-[22px] font-bold tracking-tight">{p.username}</span>
              {p.accountType === "bot" && (
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
                  BOT
                </span>
              )}
            </div>
            {p.vpnDetected && (
              <span
                className="mt-1.5 rounded-full border border-amber-400/35 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300"
                title={t("profile.vpn")}
              >
                🛡 {t("profile.vpn")}
              </span>
            )}
            {/* Short form shown; the copy button carries the full address */}
            <button
              onClick={() => {
                copyText(p.address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="pressable mt-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] text-indigo-300/70 hover:bg-white/[0.06]"
              title={t("common.copy")}
            >
              {p.address.slice(0, 6)}…{p.address.slice(-4)}
              <span className="text-[10px]">{copied ? "✓" : "⧉"}</span>
            </button>
          </div>

          {/* Trust score */}
          <div className="inset-group flex items-center justify-between px-4 py-3">
            <div className="text-xs text-slate-400">{t("profile.trustLabel")}</div>
            <div
              className="text-[26px] font-black tabular-nums"
              style={{
                color: trustColor(p.trustScore),
                textShadow: `0 0 16px ${trustColor(p.trustScore)}55`,
              }}
              title={t("trust.badgeTitle")}
            >
              {p.trustScore}
              <span className="ml-0.5 text-xs font-semibold text-slate-500">/100</span>
            </div>
          </div>

          {p.bio && (
            <p className="px-1 text-center text-sm leading-relaxed text-slate-300">
              {p.bio}
            </p>
          )}

          <div className="inset-group divide-y divide-white/[0.06] overflow-hidden text-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-slate-400">{t("profile.genderLabel")}</span>
              <span>
                {p.gender
                  ? t(`profile.gender.${p.gender}` as TKey)
                  : t("profile.private")}
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs text-slate-400">{t("profile.locationLabel")}</span>
              <span>
                {p.location.country ?? t("profile.private")}
                {p.location.mode === "approx" && (
                  <span className="ml-1 text-[10px] text-slate-500">
                    {t("profile.approx")}
                  </span>
                )}
              </span>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs text-slate-400">{t("profile.assetsLabel")}</div>
              <div className="num-glow mt-0.5 text-lg font-bold">
                {p.assets.mode === "visible" &&
                  `$${Math.round(p.assets.usd ?? 0).toLocaleString()}`}
                {p.assets.mode === "blurred" && (
                  <span title={t("profile.blurred")} className="tracking-widest">
                    {"$".repeat(Math.max(1, p.assets.digits ?? 1))}
                  </span>
                )}
                {p.assets.mode === "hidden" && (
                  <span className="text-sm text-slate-500">{t("profile.private")}</span>
                )}
              </div>
            </div>
            {p.link && (
              <a
                href={p.link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="block truncate px-4 py-3 text-sm text-indigo-400 hover:text-indigo-300"
              >
                {p.link}
              </a>
            )}
          </div>

          {!p.isMe && (
            <div className="mt-1 flex flex-col gap-2.5">
              {p.canMessage ? (
                <>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t("profile.greetPh")}
                    rows={3}
                    className="field resize-none !rounded-[18px]"
                  />
                  {sendResult && <p className="text-xs text-red-400">{sendResult}</p>}
                  <button
                    onClick={sendFirstMessage}
                    disabled={sending || !draft.trim()}
                    className="btn-primary py-3 text-sm"
                  >
                    {sending ? t("profile.sendingDm") : t("profile.sendDm")}
                  </button>
                </>
              ) : (
                !p.blockedByMe && (
                  <p className="text-center text-xs text-slate-500">
                    {p.accountType === "bot" ? "" : t("profile.cannotDm")}
                  </p>
                )
              )}
              <button
                onClick={toggleBlock}
                className={`pressable rounded-full border py-2.5 text-sm font-semibold ${
                  p.blockedByMe
                    ? "border-white/15 text-slate-300 hover:bg-white/5"
                    : "border-red-400/25 bg-red-500/5 text-red-400 hover:bg-red-500/10"
                }`}
              >
                {p.blockedByMe ? t("profile.unblockBtn") : t("profile.blockBtn")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
