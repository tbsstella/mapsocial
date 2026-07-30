"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { MapView, type MapUser, type MapEvent } from "@/components/MapView";
import { CreateSheet } from "@/components/CreateSheet";
import { ProfileSheet } from "@/components/ProfileSheet";
import { SettingsSheet } from "@/components/SettingsSheet";
import { ChatDock, ThreadsPanel } from "@/components/ChatDock";
import {
  UserListCard,
  type ListedUser,
  type NearbyTab,
} from "@/components/UserListCard";
import {
  AddressSearch,
  FilterPanel,
  loadFilters,
  saveFilters,
  type MapFilterState,
} from "@/components/FilterBar";
import { Avatar, avatarKind } from "@/components/Avatar";
import { useMe } from "@/hooks/useMe";
import { useSiweLogin } from "@/hooks/useSiweLogin";
import { haversineKm, type DistanceUnit } from "@/lib/geo";
import { countryByCode } from "@/lib/countries";
import { useI18n, LANGS, type Lang } from "@/lib/i18n";

// One window shows at a time (tabbed), so several chats can stay open.
const MAX_OPEN_CHATS = 5;

type Panel = "none" | "threads" | "settings" | "nearby" | "cluster" | "create";

export default function HomePage() {
  const { me, isLoading, invalidate } = useMe();
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [accountType, setAccountType] = useState<"human" | "bot">("human");
  const [panel, setPanel] = useState<Panel>("none");
  const [clusterUsers, setClusterUsers] = useState<MapUser[]>([]);
  const [openChats, setOpenChats] = useState<number[]>([]);
  const [focus, setFocus] = useState<{ lat: number; lng: number; nonce: number } | null>(
    null
  );
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [filters, setFilters] = useState<MapFilterState>(() => loadFilters());
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [nearbyTab, setNearbyTab] = useState<NearbyTab>("human");

  const updateFilters = useCallback((f: MapFilterState) => {
    setFilters(f);
    saveFilters(f);
  }, []);

  const { login, busy, error } = useSiweLogin(() => {
    invalidate();
  });

  const { data: mapData } = useQuery<{ users: MapUser[] }>({
    queryKey: ["mapUsers"],
    queryFn: async () => (await fetch("/api/map/users")).json(),
    refetchInterval: 30_000,
  });

  const { data: eventData } = useQuery<{ events: MapEvent[] }>({
    queryKey: ["mapEvents"],
    queryFn: async () => (await fetch("/api/map/events")).json(),
    refetchInterval: 60_000,
  });

  const onSelect = useCallback((address: string) => {
    setPanel("none");
    setSelected(address);
  }, []);

  const onClusterSelect = useCallback((users: MapUser[]) => {
    setSelected(null);
    setClusterUsers(users);
    setPanel("cluster");
  }, []);

  const openChat = useCallback((threadId: number) => {
    setPanel("none");
    setOpenChats((prev) => {
      if (prev.includes(threadId)) return prev;
      const next = [...prev, threadId];
      return next.length > MAX_OPEN_CHATS ? next.slice(next.length - MAX_OPEN_CHATS) : next;
    });
  }, []);

  const closeChat = useCallback((threadId: number) => {
    setOpenChats((prev) => prev.filter((id) => id !== threadId));
  }, []);

  const togglePanel = useCallback((p: Panel) => {
    setSelected(null);
    setPanel((cur) => (cur === p ? "none" : p));
  }, []);

  /** My approximate coordinates (shared approx location, else country centroid). */
  const myCoords = useMemo(() => {
    const p = me?.profile;
    if (!p) return null;
    if (p.lat != null && p.lng != null) return { lat: p.lat, lng: p.lng };
    const c = countryByCode(p.country);
    if (c && c.code !== "OTHER") return { lat: c.lat, lng: c.lng };
    return null;
  }, [me]);

  /** Distance unit follows the viewer's own country convention. */
  const myUnit: DistanceUnit = useMemo(
    () => countryByCode(me?.profile?.country ?? null)?.unit ?? "km",
    [me]
  );

  const withDistance = useCallback(
    (users: MapUser[]): ListedUser[] =>
      users
        .map((user) => ({
          user,
          distanceKm: myCoords
            ? haversineKm(myCoords.lat, myCoords.lng, user.lat, user.lng)
            : null,
        }))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)),
    [myCoords]
  );

  /** Checkbox filters applied to map + nearby. Users with a hidden gender
   *  are never filtered out by the gender checkboxes. */
  const visibleUsers = useMemo(
    () =>
      (mapData?.users ?? []).filter((u) => {
        if (u.isMe) return true;
        if (u.accountType === "bot") return filters.bots;
        if (u.gender === "male") return filters.male;
        if (u.gender === "female") return filters.female;
        if (u.gender === "other") return filters.other;
        return true;
      }),
    [mapData, filters]
  );

  const visibleEvents = useMemo(
    () => (filters.events ? eventData?.events ?? [] : []),
    [eventData, filters.events]
  );

  /** Nearby card items: humans obey the gender checkboxes (hidden gender
   *  always shows); the bot tab lists all bots — picking that tab is
   *  already an explicit choice. */
  const nearbyItems = useMemo(
    () =>
      withDistance(
        (mapData?.users ?? []).filter((u) => {
          if (u.isMe) return false;
          if (u.accountType === "bot") return true;
          if (u.gender === "male") return filters.male;
          if (u.gender === "female") return filters.female;
          if (u.gender === "other") return filters.other;
          return true;
        })
      ),
    [mapData, filters, withDistance]
  );

  /** Distance-sorted events for the nearby card's event tab. */
  const nearbyEvents = useMemo(
    () =>
      (eventData?.events ?? [])
        .map((ev) => ({
          ev,
          distanceKm: myCoords
            ? haversineKm(myCoords.lat, myCoords.lng, ev.lat, ev.lng)
            : null,
        }))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)),
    [eventData, myCoords]
  );

  const clusterItems = useMemo(
    () => withDistance(clusterUsers.filter((u) => !u.isMe)),
    [clusterUsers, withDistance]
  );

  const loggedIn = !!me?.user;
  const needsProfile = loggedIn && !me?.profile;
  const ready = loggedIn && !!me?.profile;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#04060d]">
      <MapView
        users={visibleUsers}
        events={visibleEvents}
        focus={focus}
        onSelect={onSelect}
        onClusterSelect={onClusterSelect}
        onCenterChange={setMapCenter}
      />

      {/* Top bar. z-50 keeps it clickable above the login overlay;
          pointer-events-none on the strip so it never blocks sheets beneath it */}
      <div className="pointer-events-none absolute left-4 right-4 top-4 z-50 flex items-start justify-between gap-2">
        {/* Top-left drawer: brand + search (paste) + nearby/events/create +
            always-visible filter checkboxes. Collapsible to keep the map clear. */}
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col items-start gap-2 overflow-y-auto pb-1">
          <div className="glass pointer-events-auto flex items-center gap-2 rounded-full py-2 pl-4 pr-2">
            <span className="text-base leading-none">🗺️</span>
            <span className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-[15px] font-bold tracking-tight text-transparent">
              MapSocial
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              {t("topbar.onMap", { n: mapData?.users.length ?? 0 })}
            </span>
            {ready && (
              <button
                onClick={() => setDrawerOpen((v) => !v)}
                className="icon-btn shrink-0"
                aria-label={t("filter.title")}
                aria-expanded={drawerOpen}
              >
                {drawerOpen ? "▲" : "▼"}
              </button>
            )}
          </div>

          {ready && drawerOpen && (
            <>
              <div className="pointer-events-auto">
                <AddressSearch onFound={onSelect} />
              </div>
              <div className="pointer-events-auto">
                {/* Nearby = the list view of a dense map (human/bot/event tabs) */}
                <button
                  onClick={() => {
                    setNearbyTab("human");
                    togglePanel("nearby");
                  }}
                  className={`glass pressable rounded-full px-3.5 py-2 text-xs font-bold ${
                    panel === "nearby" ? "text-indigo-300" : "text-slate-300"
                  }`}
                >
                  📍 {t("tab.nearby")}
                </button>
              </div>
              <div className="pointer-events-auto">
                <FilterPanel filters={filters} onChange={updateFilters} />
              </div>
            </>
          )}
        </div>

        {/* Top-right: language picker (logged out) / profile entry (logged in) */}
        <div className="pointer-events-auto flex items-center gap-2">
          {!loggedIn && (
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="glass pressable rounded-full px-3.5 py-2.5 text-xs font-bold text-slate-300 outline-none"
              aria-label="Language"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code} className="bg-[#0d1220]">
                  {l.label}
                </option>
              ))}
            </select>
          )}
          {ready && me?.profile && (
            <button
              onClick={() => togglePanel("settings")}
              className={`glass pressable flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-xs font-bold ${
                panel === "settings" ? "text-indigo-300" : "text-slate-300"
              }`}
            >
              <Avatar
                id={me.profile.avatar}
                url={me.profile.avatar_url}
                size={26}
                kind={avatarKind(me.user?.accountType, me.user?.isOrganizer)}
              />
              {t("tab.profile")}
            </button>
          )}
        </div>
      </div>

      {/* Floating bottom dock: chat only — creating lives in the profile sheet */}
      {ready && me?.profile && (
        <div className="absolute bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-40 w-max max-w-[calc(100vw-16px)] -translate-x-1/2">
          <nav className="glass dock">
            <button
              onClick={() => togglePanel("threads")}
              className={`dock-item ${panel === "threads" ? "dock-item-active" : ""}`}
            >
              <span className="dock-icon">💬</span>
              <span className="dock-label">{t("tab.chats")}</span>
            </button>
          </nav>
        </div>
      )}

      {/* Login overlay */}
      {!isLoading && !loggedIn && (
        <div className="fade-in absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-xl">
          <div className="glass-strong sheet-up mx-4 w-full max-w-sm rounded-[28px] p-8 text-slate-100">
            <div className="text-4xl">🗺️</div>
            <h1 className="mt-3 bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-[28px] font-bold tracking-tight text-transparent">
              MapSocial
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
              {t("login.tagline")}
            </p>

            <div className="seg mt-6">
              {(["human", "bot"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setAccountType(k)}
                  className={`seg-item py-2.5 ${accountType === k ? "seg-item-active" : ""}`}
                >
                  {k === "human" ? t("login.human") : t("login.bot")}
                </button>
              ))}
            </div>
            {accountType === "bot" && (
              <p className="mt-2 px-1 text-xs text-amber-400">{t("login.botHint")}</p>
            )}

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <button
              onClick={() => login(accountType)}
              disabled={busy}
              className="btn-primary mt-6 w-full py-3.5 text-[15px]"
            >
              {busy ? t("login.waitingSig") : t("login.connect")}
            </button>
            <p className="mt-4 text-center text-[11px] text-slate-600">
              {t("login.chains")}
            </p>
          </div>
        </div>
      )}

      {/* Onboarding prompt */}
      {needsProfile && (
        <div className="fade-in absolute inset-0 z-40 flex items-center justify-center bg-black/55 backdrop-blur-xl">
          <div className="glass-strong sheet-up mx-4 w-full max-w-sm rounded-[28px] p-8 text-center text-slate-100">
            <div className="text-4xl">👋</div>
            <h2 className="mt-3 text-xl font-bold tracking-tight">
              {t("onboard.connected")}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
              {t("onboard.body")}
            </p>
            <button
              onClick={() => router.push("/onboarding")}
              className="btn-primary mt-6 w-full py-3.5 text-[15px]"
            >
              {t("onboard.cta")}
            </button>
          </div>
        </div>
      )}

      {/* Right-side sheets */}
      {selected && (
        <ProfileSheet
          address={selected}
          onClose={() => setSelected(null)}
          onStartChat={openChat}
        />
      )}
      {panel === "settings" && (
        <SettingsSheet
          onClose={() => setPanel("none")}
          onOpenCreate={() => setPanel("create")}
        />
      )}
      {panel === "threads" && (
        <ThreadsPanel onOpenChat={openChat} onClose={() => setPanel("none")} />
      )}
      {panel === "nearby" && (
        <UserListCard
          title={t("nearby.title")}
          subtitle={myCoords ? undefined : t("nearby.noLoc")}
          items={nearbyItems}
          events={nearbyEvents}
          unit={myUnit}
          typeTabs
          initialTab={nearbyTab}
          onSelect={onSelect}
          onFocusEvent={(ev) =>
            setFocus({ lat: ev.lat, lng: ev.lng, nonce: (focus?.nonce ?? 0) + 1 })
          }
          onClose={() => setPanel("none")}
        />
      )}
      {panel === "create" && me?.user && (
        <CreateSheet
          center={mapCenter}
          isBot={me.user.accountType === "bot"}
          onClose={() => setPanel("none")}
          onCreated={() => {
            setNearbyTab("event");
            setPanel("nearby");
          }}
        />
      )}
      {panel === "cluster" && (
        <UserListCard
          title={t("cluster.title")}
          subtitle={t("cluster.subtitle", { n: clusterItems.length })}
          items={clusterItems}
          unit={myUnit}
          onSelect={onSelect}
          onClose={() => setPanel("none")}
        />
      )}

      {/* Floating chat windows; slide aside while a profile card is open */}
      <ChatDock openChats={openChats} onClose={closeChat} avoidRightPanel={!!selected} />
    </div>
  );
}
