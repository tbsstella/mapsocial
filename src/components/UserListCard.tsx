"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, avatarKind } from "./Avatar";
import { TrustBadge } from "./TrustBadge";
import { distanceParts, type DistanceUnit } from "@/lib/geo";
import { useI18n } from "@/lib/i18n";
import type { MapEvent, MapUser } from "./MapView";

export interface ListedUser {
  user: MapUser;
  distanceKm: number | null;
}

export interface ListedEvent {
  ev: MapEvent;
  distanceKm: number | null;
}

export type NearbyTab = "human" | "bot" | "event";

/**
 * Right-side card listing users (nearby panel / cluster drill-down).
 * The nearby variant (`typeTabs`) is the list view of the map: three tabs —
 * human / bot / event — each sorted by distance.
 */
export function UserListCard({
  title,
  subtitle,
  items,
  events,
  unit,
  typeTabs = false,
  initialTab = "human",
  onSelect,
  onFocusEvent,
  onClose,
}: {
  title: string;
  subtitle?: string;
  items: ListedUser[];
  /** Distance-sorted events for the event tab (nearby panel only). */
  events?: ListedEvent[];
  unit: DistanceUnit;
  /** Split into human / bot / event tabs (nearby panel). */
  typeTabs?: boolean;
  initialTab?: NearbyTab;
  onSelect: (address: string) => void;
  onFocusEvent?: (ev: MapEvent) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<NearbyTab>(initialTab);
  const queryClient = useQueryClient();

  async function toggleFollow(ev: MapEvent) {
    await fetch(`/api/v1/events/${ev.id}/follow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: ev.followedByMe ? "unfollow" : "follow" }),
    });
    queryClient.invalidateQueries({ queryKey: ["mapEvents"] });
  }

  const shown = typeTabs
    ? items.filter(({ user }) =>
        tab === "bot" ? user.accountType === "bot" : user.accountType !== "bot"
      )
    : items;

  const timeFmt = new Intl.DateTimeFormat(lang, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  function distanceLabel(km: number): string {
    const p = distanceParts(km, unit);
    return t(p.within ? "geo.within" : "geo.approx", {
      n: p.n,
      unit: t(unit === "mi" ? "geo.mi" : "geo.km"),
    });
  }

  return (
    <div className="glass-strong sheet-right absolute bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 top-[72px] z-20 flex w-[min(336px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] text-slate-100">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div>
          <span className="text-[17px] font-bold tracking-tight">{title}</span>
          {subtitle && <div className="mt-0.5 text-[11px] text-slate-400">{subtitle}</div>}
        </div>
        <button onClick={onClose} className="icon-btn" aria-label={t("common.close")}>
          ✕
        </button>
      </div>

      {typeTabs && (
        <div className="seg mx-4 mb-2">
          {(["human", "bot", "event"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`seg-item ${tab === k ? "seg-item-active" : ""}`}
            >
              {t(k === "human" ? "nearby.human" : k === "bot" ? "nearby.bot" : "tab.events")}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {tab === "event" && typeTabs ? (
          <>
            {(events ?? []).length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400">{t("events.empty")}</p>
            )}
            {(events ?? []).map(({ ev, distanceKm }) => (
              <div
                key={ev.id}
                className="pressable flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.06]"
              >
                <button
                  onClick={() => onFocusEvent?.(ev)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] text-lg"
                    style={{
                      border: `2px solid ${ev.themeColor}`,
                      boxShadow: ev.live ? `0 0 14px ${ev.themeColor}88` : "none",
                    }}
                  >
                    📅
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold">{ev.title}</span>
                      <span
                        className="rounded-full px-1.5 py-px text-[9px] font-bold"
                        style={{
                          background: ev.live ? `${ev.themeColor}33` : "rgba(255,255,255,.08)",
                          color: ev.live ? ev.themeColor : "#94a3b8",
                        }}
                      >
                        {ev.live ? t("events.live") : t("events.upcoming")}
                      </span>
                    </div>
                    {ev.venue && (
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        📍 {ev.venue}
                      </div>
                    )}
                    <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                      {timeFmt.format(ev.startsAt * 1000)}
                      {distanceKm != null && (
                        <span className="ml-1.5 text-slate-500">
                          · {distanceLabel(distanceKm)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                {/* Follow: holders of this event's NFT blink for you while live */}
                <button
                  onClick={() => toggleFollow(ev)}
                  className="pressable shrink-0 rounded-full px-2 py-1 text-base"
                  style={{ color: ev.followedByMe ? ev.themeColor : "#64748b" }}
                  title={ev.followedByMe ? t("events.following") : t("events.follow")}
                  aria-pressed={ev.followedByMe}
                >
                  {ev.followedByMe ? "★" : "☆"}
                  {(ev.followers ?? 0) > 0 && (
                    <span className="ml-0.5 align-middle text-[10px] tabular-nums">
                      {ev.followers}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </>
        ) : (
          <>
            {shown.length === 0 && (
              <p className="px-3 py-2 text-xs text-slate-400">{t("nearby.empty")}</p>
            )}
          </>
        )}

        {(tab !== "event" || !typeTabs) &&
          shown.map(({ user, distanceKm }) => (
          <button
            key={user.address}
            onClick={() => onSelect(user.address)}
            className="pressable flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-white/[0.06]"
          >
            <Avatar
              id={user.avatar}
              url={user.avatarUrl}
              size={40}
              kind={avatarKind(user.accountType, user.isOrganizer)}
              gender={user.gender}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-semibold">{user.username}</span>
                {user.accountType === "bot" && (
                  <span className="rounded-md bg-white/10 px-1.5 py-px text-[9px] font-bold text-slate-300">
                    BOT
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <TrustBadge score={user.trustScore} />
                {distanceKm != null && (
                  <span className="text-[11px] tabular-nums text-slate-400">
                    {user.locationMode === "country" ? `${t("nearby.countryEst")} · ` : ""}
                    {distanceLabel(distanceKm)}
                  </span>
                )}
              </div>
            </div>
            <span className="text-slate-600">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
