"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ProfileForm } from "./ProfileForm";
import { Avatar, avatarKind } from "./Avatar";
import { SimnRow } from "./CreateShared";
import { trustColor } from "./TrustBadge";
import { useMe } from "@/hooks/useMe";
import { useI18n } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";

interface BlockedUser {
  address: string;
  username: string | null;
  avatar: string | null;
}

export function SettingsSheet({
  onClose,
  onOpenCreate,
}: {
  onClose: () => void;
  onOpenCreate: () => void;
}) {
  const { me, invalidate } = useMe();
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"profile" | "trust" | "blocklist">("profile");
  const [copied, setCopied] = useState(false);
  const [addrCopied, setAddrCopied] = useState(false);

  const { data: blocklist } = useQuery<{ blocked: BlockedUser[] }>({
    queryKey: ["blocklist"],
    queryFn: async () => (await fetch("/api/blocklist")).json(),
    enabled: tab === "blocklist",
  });

  if (!me?.user) return null;

  const refLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/r/${me.user.referralCode}`
      : "";

  async function unblock(address: string) {
    await fetch(`/api/users/${address}/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unblock" }),
    });
    queryClient.invalidateQueries({ queryKey: ["blocklist"] });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    invalidate();
    onClose();
    router.refresh();
  }

  const tabs = [
    { id: "profile", label: t("settings.tab.profile") },
    { id: "trust", label: t("settings.tab.trust") },
    { id: "blocklist", label: t("settings.tab.blocklist") },
  ] as const;

  const bonusStr = me.quota?.bonus
    ? t("settings.quotaBonus", { n: me.quota.bonus })
    : "";

  return (
    <div className="glass-strong sheet-right absolute bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 top-[72px] z-20 w-[min(336px,calc(100vw-32px))] overflow-y-auto rounded-[26px] p-5 text-slate-100">
      {/* Sticky so the sheet can always be closed without scrolling back up */}
      <div className="sticky top-0 z-10 -mb-7 flex justify-end">
        <button onClick={onClose} className="icon-btn" aria-label={t("common.close")}>
          ✕
        </button>
      </div>

      <div className="flex items-center justify-between pr-9">
        <div className="flex items-center gap-3">
          {me.profile && (
            <Avatar
              id={me.profile.avatar}
              url={me.profile.avatar_url}
              size={48}
              ring
              kind={avatarKind(me.user.accountType, me.user.isOrganizer)}
              gender={me.profile.gender}
            />
          )}
          <div>
            <div className="text-[16px] font-bold tracking-tight">
              {me.profile?.username ?? t("common.notSet")}
            </div>
            <button
              onClick={() => {
                copyText(me.user!.address);
                setAddrCopied(true);
                setTimeout(() => setAddrCopied(false), 1500);
              }}
              className="pressable -ml-1.5 flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] text-indigo-300/70 hover:bg-white/[0.06]"
              title={t("common.copy")}
            >
              {me.user.address.slice(0, 8)}…{me.user.address.slice(-6)}
              {me.user.accountType === "bot" && " · BOT"}
              <span className="text-[10px]">{addrCopied ? "✓" : "⧉"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* The single home for trust score + daily approach quota. */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="inset-group px-4 py-3">
          <div className="text-[11px] text-slate-400">{t("profile.trustLabel")}</div>
          <div
            className="text-[24px] font-black tabular-nums"
            style={{
              color: trustColor(me.user.trustScore),
              textShadow: `0 0 14px ${trustColor(me.user.trustScore)}55`,
            }}
            title={t("trust.badgeTitle")}
          >
            {me.user.trustScore}
            <span className="ml-0.5 text-xs font-semibold text-slate-500">/100</span>
          </div>
        </div>
        <div className="inset-group px-4 py-3">
          <div className="text-[11px] text-slate-400">
            {t("topbar.quotaPre")}
            {t("topbar.quotaPost") && ` (${t("topbar.quotaPost")})`}
          </div>
          <div className="num-glow text-[24px] font-black">
            {me.quota?.remaining ?? 0}
            <span className="ml-0.5 text-xs font-semibold text-slate-500">
              /{(me.quota?.base ?? 0) + (me.quota?.bonus ?? 0)}
            </span>
          </div>
        </div>
      </div>

      {/* SIMN balance + built-in swap, right under the vibes score */}
      <div className="mt-2">
        <SimnRow />
      </div>

      <div className="seg mt-4">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`seg-item ${tab === tb.id ? "seg-item-active" : ""}`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "profile" && (
          <div className="flex flex-col gap-5">
            <ProfileForm me={me} submitLabel={t("form.save")} onSaved={invalidate} />

            {/* Creator hub entry lives here, right above referral */}
            <button
              onClick={onOpenCreate}
              className="inset-group pressable flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.05]"
            >
              <span className="text-xl">➕</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{t("tab.create")}</div>
                <div className="truncate text-[11px] text-slate-500">
                  {t("create.newEvent")} · {t("create.newBot")}
                </div>
              </div>
              <span className="text-slate-500">›</span>
            </button>

            {me.referral && (
              <div className="inset-group flex flex-col gap-3 p-4">
                <div className="text-sm font-semibold">{t("settings.refLink")}</div>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={refLink}
                    className="field min-w-0 flex-1 !rounded-full font-mono !text-xs !text-indigo-200"
                  />
                  <button
                    onClick={() => {
                      copyText(refLink);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="btn-primary shrink-0 px-4 text-xs"
                  >
                    {copied ? t("common.copied") : t("common.copy")}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-[14px] bg-white/[0.04] p-3">
                    <div className="num-glow text-xl font-black">
                      {me.referral.invitedCount}
                    </div>
                    <div className="text-[11px] text-slate-500">{t("settings.invited")}</div>
                  </div>
                  <div className="rounded-[14px] bg-white/[0.04] p-3">
                    <div className="num-glow text-xl font-black">
                      {me.quota?.bonus ?? 0}
                    </div>
                    <div className="text-[11px] text-slate-500">{t("settings.bonusSlots")}</div>
                  </div>
                </div>
                <div className="text-xs leading-relaxed text-slate-400">
                  {t("settings.refRules", {
                    a: me.referral.config.inviterCredits,
                    b: me.referral.config.inviteeCredits,
                    d: me.referral.config.creditTtlDays,
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "trust" && (
          <div className="flex flex-col gap-4">
            <div className="text-center">
              <div className="num-glow text-5xl font-black">{me.user.trustScore}</div>
            </div>
            {me.user.trustDetail && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {(
                  [
                    ["settings.base", `${me.user.trustDetail.base ?? 50}`, false],
                    ["settings.activity", `+${me.user.trustDetail.activity} / 20`, false],
                    ["settings.assets", `+${me.user.trustDetail.assets} / 18`, false],
                    ["settings.diversity", `+${me.user.trustDetail.diversity} / 12`, false],
                    ["settings.penalty", `-${me.user.trustDetail.penalty}`, true],
                  ] as const
                ).map(([key, val, danger]) => (
                  <div key={key} className="inset-group p-3.5">
                    <div className="text-xs text-slate-500">{t(key)}</div>
                    <div
                      className={`mt-0.5 font-bold tabular-nums ${danger ? "text-red-400" : ""}`}
                    >
                      {val}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div>
              <div className="mb-2 text-sm font-semibold">
                {t("settings.assetsTotal")}
                <span className="num-glow font-bold">
                  ${Math.round(me.user.assetsUsd ?? 0).toLocaleString()}
                </span>
              </div>
              <div className="inset-group divide-y divide-white/[0.06] overflow-hidden">
                {(me.user.assetsDetail ?? []).map((c) => (
                  <div
                    key={c.key}
                    className="flex items-center justify-between px-4 py-2.5 text-sm"
                  >
                    <span className="text-slate-300">{c.label}</span>
                    <span className="text-xs tabular-nums text-slate-500">
                      {c.txCount} txs
                    </span>
                    <span className="font-semibold tabular-nums">
                      {c.error
                        ? t("settings.readFail")
                        : `$${Math.round(c.totalUsd).toLocaleString()}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[18px] border border-indigo-400/20 bg-indigo-500/10 p-3.5 text-sm text-indigo-200">
              {t("settings.quotaLine", {
                remaining: me.quota?.remaining ?? 0,
                base: me.quota?.base ?? 0,
                bonus: bonusStr,
                consumed: me.quota?.consumed ?? 0,
              })}
            </div>
          </div>
        )}

        {tab === "blocklist" && (
          <div className="flex flex-col gap-2">
            {(blocklist?.blocked ?? []).length === 0 && (
              <p className="text-sm text-slate-500">{t("settings.blockEmpty")}</p>
            )}
            {(blocklist?.blocked ?? []).map((b) => (
              <div key={b.address} className="inset-group flex items-center gap-3 px-4 py-3">
                <Avatar id={b.avatar ?? "default"} size={34} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {b.username ?? t("common.notSet")}
                  </div>
                  <div className="truncate font-mono text-[10px] text-slate-500">
                    {b.address}
                  </div>
                </div>
                <button
                  onClick={() => unblock(b.address)}
                  className="pressable ml-auto shrink-0 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5"
                >
                  {t("settings.unblock")}
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={logout}
          className="pressable mt-6 w-full rounded-full border border-red-400/25 bg-red-500/5 py-2.5 text-sm font-semibold text-red-400 hover:bg-red-500/10"
        >
          {t("settings.logout")}
        </button>
      </div>
    </div>
  );
}
