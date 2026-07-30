"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { APP_CHAINS } from "@/lib/chains";
import { forwardGeocode, reverseGeocode, type GeoPoint } from "@/lib/geocode";
import { apiErrorText, useI18n } from "@/lib/i18n";
import {
  ApiDocCard,
  AvatarUploader,
  CreatePanelShell,
  SHOW_SDK,
  SimnRow,
  StakeCard,
  TIER_ORGANIZER,
  useLicense,
} from "./CreateShared";

/** Integration contract, phrased for both developers and AI agents. */
const EVENTS_API_DOC = `MapSocial Events API (cookie session via SIWE login)
Licensing (enforced server-side, same for UI/API/SDK):
  1 organizer stake position (tier 1, LicenseStake, 2000 SIMN)
  = 1 concurrent live event. Over quota -> 429 EVENT_LIMIT.
GET /api/license                 # your positions, prices, contract addr
POST /api/v1/events
  { title, description?, lat, lng,
    venue?: "street address",    # precise venue shown in lists; lat/lng
                                 # should hold the geocoded coordinates
    startsAt, endsAt,            # unix seconds, <= 30 days span
    themeColor: "#rrggbb",
    link?: "https://...",        # your event page / ticketing
    nftContract?: "0x...",       # any NFT you issued anywhere
    nftChain: ethereum|polygon|arbitrum|robinhood|hyperevm,
    nftStandard: erc721|erc1155, nftTokenId? (1155 only) }
GET /api/v1/events               # public list (live + upcoming)
Effect: while live, NFT holders glow in the event theme color on the map.
SDK (Node, wraps SIWE login + all calls): sdk/mapsocial.mjs
  const ms = new MapSocial({ baseUrl }); await ms.login(key);
  (await ms.license()).organizer.ok && await ms.createEvent({...})`;

const THEME_COLORS = ["#8b5cf6", "#38bdf8", "#34d399", "#fbbf24", "#fb7185", "#e879f9"];

/** One-tap duration presets; labels are universal so no i18n needed. */
const DURATIONS: { label: string; hours: number }[] = [
  { label: "2h", hours: 2 },
  { label: "4h", hours: 4 },
  { label: "8h", hours: 8 },
  { label: "1d", hours: 24 },
  { label: "3d", hours: 72 },
];

function toUnix(v: string): number {
  return Math.floor(new Date(v).getTime() / 1000);
}

function localDatetime(offsetMs: number): string {
  const d = new Date(Date.now() + offsetMs - new Date().getTimezoneOffset() * 60_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

function plusHours(startLocal: string, hours: number): string {
  const d = new Date(startLocal);
  if (Number.isNaN(d.getTime())) return startLocal;
  d.setTime(d.getTime() + hours * 3_600_000 - d.getTimezoneOffset() * 60_000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

/**
 * Organizer panel. Lightweight: basics (what/when) + place (map center) +
 * look (theme color). NFT is a pure plug-in point — any ERC-721/1155 issued
 * anywhere can be connected by address; ticket design, sales and rules stay
 * entirely with the organizer. Full programmatic access via the API/SDK card.
 */
export function CreateEventSheet({
  center,
  onBack,
  onClose,
  onCreated,
}: {
  center: { lat: number; lng: number } | null;
  onBack?: () => void;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const { data: lic } = useLicense();

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [starts, setStarts] = useState(() => localDatetime(15 * 60 * 1000));
  const [ends, setEnds] = useState(() => localDatetime(3 * 60 * 60 * 1000));
  const [color, setColor] = useState(THEME_COLORS[0]);
  const [link, setLink] = useState("");

  // Precise venue: auto-filled from the map center (reverse geocode), and
  // editable — "locate" turns the typed address into exact coordinates that
  // the map marker will use.
  const [venue, setVenue] = useState("");
  const [coords, setCoords] = useState<GeoPoint | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locError, setLocError] = useState(false);
  const autoFilled = useRef(false);

  useEffect(() => {
    if (autoFilled.current || !center) return;
    autoFilled.current = true;
    reverseGeocode(center, lang).then((label) => {
      if (label) {
        setVenue((v) => (v ? v : label));
        setCoords((c) => c ?? center);
      }
    });
  }, [center, lang]);

  async function fillFromCenter() {
    if (!center || locBusy) return;
    setLocBusy(true);
    setLocError(false);
    const label = await reverseGeocode(center, lang);
    if (label) {
      setVenue(label);
      setCoords(center);
    } else {
      setLocError(true);
    }
    setLocBusy(false);
  }

  async function locateVenue() {
    if (!venue.trim() || locBusy) return;
    setLocBusy(true);
    setLocError(false);
    const hit = await forwardGeocode(venue.trim(), lang);
    if (hit) {
      setVenue(hit.label);
      setCoords({ lat: hit.lat, lng: hit.lng });
    } else {
      setLocError(true);
    }
    setLocBusy(false);
  }

  // NFT plug-in point (optional): connect any externally issued NFT by
  // address. Polygon preselected as the cheap mature default.
  const [ticketOpen, setTicketOpen] = useState(false);
  const [nftChain, setNftChain] = useState(
    APP_CHAINS.some((c) => c.key === "polygon") ? "polygon" : APP_CHAINS[0].key
  );
  const [nftStandard, setNftStandard] = useState<"erc721" | "erc1155">("erc721");
  const [nftContract, setNftContract] = useState("");
  const [nftTokenId, setNftTokenId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  // Organizers are UI-first; the API/SDK contract stays one tap away for
  // agencies and AI agents doing programmatic/batch creation.
  const [devOpen, setDevOpen] = useState(false);

  const organizerReady = !!lic && lic.organizer.ok;
  const slotFree =
    !!lic && (lic.organizer.activeEvents ?? 0) < Math.max(lic.organizer.slots, 1);

  async function submit() {
    const point = coords ?? center;
    if (!point) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: desc,
          lat: point.lat,
          lng: point.lng,
          venue: venue.trim() || undefined,
          startsAt: toUnix(starts),
          endsAt: toUnix(ends),
          themeColor: color,
          link: link.trim() || undefined,
          ...(ticketOpen && nftContract.trim()
            ? {
                nftContract: nftContract.trim(),
                nftChain,
                nftStandard,
                nftTokenId: nftStandard === "erc1155" ? nftTokenId.trim() : undefined,
              }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorText(data, t));
      setCreated(true);
      setTitle("");
      setDesc("");
      setNftContract("");
      queryClient.invalidateQueries({ queryKey: ["mapEvents"] });
      queryClient.invalidateQueries({ queryKey: ["license"] });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("err.GENERIC"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CreatePanelShell
      title={t("create.newEvent")}
      subtitle={t("create.organizerHint")}
      onBack={onBack}
      onClose={onClose}
    >
      <SimnRow />

      {!lic && <p className="px-1 text-xs text-slate-500">{t("common.loading")}</p>}

      {lic && (
        <StakeCard
          tier={TIER_ORGANIZER}
          status={lic.organizer}
          contract={lic.contract}
          referrer={lic.inviterAddress}
          heading={t("create.organizer")}
          hint={t("create.feeNote")}
        />
      )}

      {organizerReady && (
        <AvatarUploader kind="organizer" />
      )}

      {organizerReady && (
        <div className="inset-group p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">{t("create.newEvent")}</span>
            <span className="text-[10px] tabular-nums text-slate-500">
              {t("create.quotaUsed", {
                a: lic!.organizer.activeEvents ?? 0,
                b: Math.max(lic!.organizer.slots, 1),
              })}
            </span>
          </div>

          {created && (
            <p className="mt-2 rounded-xl bg-emerald-400/10 px-3 py-1.5 text-[11px] text-emerald-300">
              {t("create.created")}
            </p>
          )}

          <div className="mt-3 flex flex-col gap-2.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("create.eventTitlePh")}
              className="field !py-2 text-sm"
            />
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value.slice(0, 500))}
              placeholder={t("create.eventDescPh")}
              rows={2}
              className="field resize-none !py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-500">
                {t("create.starts")}
                <input
                  type="datetime-local"
                  value={starts}
                  onChange={(e) => setStarts(e.target.value)}
                  className="field mt-1 !px-2.5 !py-1.5 !text-xs"
                />
              </label>
              <label className="text-[10px] text-slate-500">
                {t("create.ends")}
                <input
                  type="datetime-local"
                  value={ends}
                  onChange={(e) => setEnds(e.target.value)}
                  className="field mt-1 !px-2.5 !py-1.5 !text-xs"
                />
              </label>
            </div>
            {/* One-tap duration: sets the end time from the start time */}
            <div className="flex gap-1.5">
              {DURATIONS.map((d) => {
                const active = ends === plusHours(starts, d.hours);
                return (
                  <button
                    key={d.label}
                    onClick={() => setEnds(plusHours(starts, d.hours))}
                    className={`pressable flex-1 rounded-full py-1 text-[10px] font-bold tabular-nums transition-colors ${
                      active
                        ? "bg-white/90 text-slate-900"
                        : "bg-white/[0.06] text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <div>
              <div className="text-[10px] text-slate-500">{t("create.theme")}</div>
              <div className="mt-1.5 flex gap-2">
                {THEME_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    aria-label={c}
                    className={`pressable h-7 w-7 rounded-full ${
                      color === c
                        ? "ring-2 ring-white/80 ring-offset-2 ring-offset-[#0d101b]"
                        : ""
                    }`}
                    style={{ background: c, boxShadow: `0 0 10px ${c}66` }}
                  />
                ))}
              </div>
            </div>

            {/* NFT Ticket */}
            <div className="rounded-[16px] border border-white/[0.07] bg-white/[0.03] p-3">
              <button
                onClick={() => setTicketOpen((v) => !v)}
                className="flex w-full items-center justify-between"
              >
                <span className="text-xs font-bold text-slate-200">
                  🎟 {t("create.nftTicket")}
                </span>
                <span className="text-slate-500">{ticketOpen ? "−" : "+"}</span>
              </button>
              {ticketOpen && (
                <div className="mt-2.5 flex flex-col gap-2">
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    {t("create.nftTicketHint")}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={nftChain}
                      onChange={(e) => setNftChain(e.target.value)}
                      className="field !bg-[#0d1220] !px-2.5 !py-1.5 !text-xs"
                      aria-label={t("create.nftChain")}
                    >
                      {APP_CHAINS.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={nftStandard}
                      onChange={(e) =>
                        setNftStandard(e.target.value as "erc721" | "erc1155")
                      }
                      className="field !bg-[#0d1220] !px-2.5 !py-1.5 !text-xs"
                      aria-label={t("create.nftStandard")}
                    >
                      <option value="erc721">ERC-721</option>
                      <option value="erc1155">ERC-1155</option>
                    </select>
                  </div>
                  <input
                    value={nftContract}
                    onChange={(e) => setNftContract(e.target.value)}
                    placeholder={t("create.nftContractPh")}
                    className="field !py-1.5 font-mono !text-xs"
                  />
                  {nftStandard === "erc1155" && (
                    <input
                      value={nftTokenId}
                      onChange={(e) => setNftTokenId(e.target.value)}
                      placeholder={t("create.nftTokenIdPh")}
                      className="field !py-1.5 font-mono !text-xs"
                    />
                  )}
                </div>
              )}
            </div>

            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={t("create.eventLinkPh")}
              className="field !py-2 text-sm"
            />

            {/* Precise venue */}
            <div className="rounded-[16px] border border-white/[0.07] bg-white/[0.03] p-3">
              <div className="text-xs font-bold text-slate-200">
                📍 {t("create.venue")}
              </div>
              <textarea
                value={venue}
                onChange={(e) => {
                  setVenue(e.target.value.slice(0, 200));
                  setLocError(false);
                }}
                placeholder={t("create.venuePh")}
                rows={2}
                className="field mt-2 resize-none !py-1.5 !text-xs"
              />
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={fillFromCenter}
                  disabled={!center || locBusy}
                  className="pressable flex-1 rounded-full bg-white/[0.06] py-1.5 text-[10px] font-bold text-slate-300 hover:bg-white/10 disabled:opacity-40"
                >
                  ⌖ {t("create.useCenter")}
                </button>
                <button
                  onClick={locateVenue}
                  disabled={!venue.trim() || locBusy}
                  className="pressable flex-1 rounded-full bg-indigo-500/20 py-1.5 text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-40"
                >
                  {locBusy ? "…" : `🎯 ${t("create.locate")}`}
                </button>
              </div>
              {locError && (
                <p className="mt-1.5 text-[10px] text-red-400">{t("create.geoFail")}</p>
              )}
              {(coords ?? center) && (
                <p className="mt-1.5 text-[10px] tabular-nums text-indigo-300/70">
                  ({(coords ?? center)!.lat.toFixed(4)}, {(coords ?? center)!.lng.toFixed(4)})
                </p>
              )}
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              onClick={submit}
              disabled={
                submitting || title.trim().length < 3 || !(coords ?? center) || !slotFree
              }
              className="btn-primary py-2.5 text-xs"
            >
              {submitting ? t("form.saving") : t("create.submitEvent")}
            </button>
          </div>
        </div>
      )}

      {SHOW_SDK && (
        <>
          <button
            onClick={() => setDevOpen((v) => !v)}
            className="pressable flex items-center justify-between rounded-[16px] border border-white/[0.07] bg-white/[0.03] px-4 py-2.5"
          >
            <span className="text-xs font-bold text-slate-300">⌥ {t("create.devDocs")}</span>
            <span className="text-slate-500">{devOpen ? "−" : "+"}</span>
          </button>
          {devOpen && (
            <ApiDocCard
              title={t("create.sdkTitle")}
              hint={t("create.eventSdkHint")}
              doc={EVENTS_API_DOC}
            />
          )}
        </>
      )}
    </CreatePanelShell>
  );
}
