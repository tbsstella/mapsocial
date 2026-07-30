"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type StyleSpecification,
} from "maplibre-gl";
import { avatarById } from "@/lib/avatars";
import { trustColor } from "./TrustBadge";

export interface MapUser {
  address: string;
  username: string;
  avatar: string;
  avatarUrl: string | null;
  accountType: string;
  isOrganizer?: boolean;
  gender?: string | null;
  trustScore: number;
  lat: number;
  lng: number;
  locationMode: string;
  isMe: boolean;
}

export interface MapEvent {
  id: number;
  title: string;
  lat: number;
  lng: number;
  startsAt: number;
  endsAt: number;
  themeColor: string;
  live: boolean;
  gated: boolean;
  holders: string[];
  venue?: string | null;
  followedByMe?: boolean;
  followers?: number;
}

/** Dark cosmos basemap (CARTO dark, no labels, no API key). */
const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    { id: "space", type: "background", paint: { "background-color": "#05070f" } },
    { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.92 } },
  ],
};

const CLUSTER_RADIUS_PX = 44;
const MAX_ZOOM = 12;

interface Cluster {
  lat: number;
  lng: number;
  users: MapUser[];
}

interface HolderGlow {
  color: string;
  /** true when the viewer follows the event: holders blink, not just glow */
  blink: boolean;
}

function buildAvatarEl(u: MapUser, glow?: HolderGlow): HTMLDivElement {
  const glowColor = glow?.color;
  const a = avatarById(u.avatar);
  const el = document.createElement("div");
  el.className = "map-marker";
  el.title = `${u.username} · ${u.trustScore}`;
  const border = glowColor ?? (u.isMe ? "#f8fafc" : trustColor(u.trustScore));
  const shadow = glowColor
    ? ""
    : `box-shadow:0 0 14px ${u.isMe ? "rgba(248,250,252,.8)" : "rgba(129,140,248,.65)"};`;
  const face = u.avatarUrl
    ? `<img src="${u.avatarUrl.replace(/"/g, "")}" alt="" style="width:100%;height:100%;object-fit:cover;" />`
    : a.emoji;
  // Role shapes: organizers are rounded squares, bots carry an AI badge.
  const isBot = u.accountType === "bot";
  const radius = !isBot && u.isOrganizer ? "11px" : "9999px";
  const badge = isBot
    ? `<span style="position:absolute;right:-3px;bottom:-3px;
        background:#6366f1;color:#fff;font-size:8px;font-weight:800;line-height:1;
        padding:2px 4px;border-radius:9999px;border:2px solid #0d101b;">AI</span>`
    : "";
  el.innerHTML = `
    <div style="position:relative;">
      <div class="${glowColor ? (glow?.blink ? "event-glow-blink" : "event-glow") : ""}" style="
        width:38px;height:38px;border-radius:${radius};overflow:hidden;
        display:flex;align-items:center;justify-content:center;
        font-size:19px;
        background:linear-gradient(135deg,${a.from},${a.to});
        border:2.5px solid ${border};
        ${shadow}
        ${glowColor ? `--glow:${glowColor};` : ""}
      ">${face}</div>${badge}
    </div>`;
  return el;
}

function buildEventEl(ev: MapEvent): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-marker";
  el.title = ev.title;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:3px;">
      <div class="${ev.live ? "event-glow" : ""}" style="
        width:34px;height:34px;border-radius:12px;
        display:flex;align-items:center;justify-content:center;font-size:17px;
        background:rgba(5,7,15,.85);backdrop-filter:blur(6px);
        border:2.5px solid ${ev.themeColor};
        ${ev.live ? `--glow:${ev.themeColor};` : `box-shadow:0 0 10px ${ev.themeColor}55;opacity:.75;`}
      ">📅</div>
      <div style="
        max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        font-size:10px;font-weight:700;color:#e2e8f0;
        background:rgba(5,7,15,.75);border:1px solid ${ev.themeColor}88;
        border-radius:9999px;padding:1px 7px;
      ">${ev.title.replace(/</g, "&lt;")}</div>
    </div>`;
  return el;
}

function buildClusterEl(c: Cluster): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "map-marker";
  el.title = `${c.users.length} 位用户，点击放大`;
  const preview = c.users
    .slice(0, 3)
    .map((u) => avatarById(u.avatar).emoji)
    .join("");
  el.innerHTML = `
    <div style="
      min-width:48px;height:48px;border-radius:9999px;padding:0 8px;
      display:flex;align-items:center;justify-content:center;gap:1px;
      font-size:15px;
      background:radial-gradient(circle at 30% 30%, #312e81, #0f172a);
      border:2.5px solid #818cf8;
      box-shadow:0 0 18px rgba(129,140,248,.85);
      position:relative;
    ">
      <span>${preview}</span>
      <span style="
        position:absolute;top:-7px;right:-7px;
        background:#818cf8;color:#0f172a;font-weight:800;font-size:11px;
        border-radius:9999px;min-width:20px;height:20px;padding:0 4px;
        display:flex;align-items:center;justify-content:center;
        border:2px solid #05070f;
      ">${c.users.length}</span>
    </div>`;
  return el;
}

export function MapView({
  users,
  events = [],
  focus,
  onSelect,
  onClusterSelect,
  onCenterChange,
}: {
  users: MapUser[];
  events?: MapEvent[];
  /** Change the nonce to fly the camera to a point (e.g. an event). */
  focus?: { lat: number; lng: number; nonce: number } | null;
  onSelect: (address: string) => void;
  onClusterSelect: (users: MapUser[]) => void;
  /** Fired on load and after each pan/zoom (used as the event location picker). */
  onCenterChange?: (c: { lat: number; lng: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const usersRef = useRef<MapUser[]>(users);
  const eventsRef = useRef<MapEvent[]>(events);
  const onSelectRef = useRef(onSelect);
  const onClusterSelectRef = useRef(onClusterSelect);
  const onCenterChangeRef = useRef(onCenterChange);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onClusterSelectRef.current = onClusterSelect;
    onCenterChangeRef.current = onCenterChange;
  }, [onSelect, onClusterSelect, onCenterChange]);

  /** Greedy screen-space clustering at the current zoom. */
  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const pts = usersRef.current.map((u) => ({ u, p: map.project([u.lng, u.lat]) }));
    const used = new Array(pts.length).fill(false);
    const clusters: Cluster[] = [];

    for (let i = 0; i < pts.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const members = [pts[i].u];
      for (let j = i + 1; j < pts.length; j++) {
        if (used[j]) continue;
        const dx = pts[i].p.x - pts[j].p.x;
        const dy = pts[i].p.y - pts[j].p.y;
        if (dx * dx + dy * dy < CLUSTER_RADIUS_PX * CLUSTER_RADIUS_PX) {
          used[j] = true;
          members.push(pts[j].u);
        }
      }
      clusters.push({
        lat: members.reduce((s, u) => s + u.lat, 0) / members.length,
        lng: members.reduce((s, u) => s + u.lng, 0) / members.length,
        users: members,
      });
    }

    // address (lowercase) => glow of the first live event it holds.
    // Followed events win so their holders blink for the viewer.
    const glowByAddress = new Map<string, { color: string; blink: boolean }>();
    for (const ev of eventsRef.current) {
      if (!ev.live) continue;
      for (const addr of ev.holders) {
        const key = addr.toLowerCase();
        const cur = glowByAddress.get(key);
        if (!cur || (ev.followedByMe && !cur.blink)) {
          glowByAddress.set(key, { color: ev.themeColor, blink: !!ev.followedByMe });
        }
      }
    }

    for (const ev of eventsRef.current) {
      markersRef.current.push(
        new Marker({ element: buildEventEl(ev) }).setLngLat([ev.lng, ev.lat]).addTo(map)
      );
    }

    for (const c of clusters) {
      let el: HTMLDivElement;
      if (c.users.length === 1) {
        const u = c.users[0];
        el = buildAvatarEl(u, glowByAddress.get(u.address.toLowerCase()));
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectRef.current(u.address);
        });
      } else {
        el = buildClusterEl(c);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          const m = mapRef.current;
          if (m) {
            m.easeTo({
              center: [c.lng, c.lat],
              zoom: Math.min(m.getZoom() + 2.5, MAX_ZOOM),
              duration: 600,
            });
          }
          onClusterSelectRef.current(c.users);
        });
      }
      markersRef.current.push(
        new Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map)
      );
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [20, 25],
      zoom: 1.8,
      minZoom: 1,
      maxZoom: MAX_ZOOM, // hard cap: never street-level precision
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    map.on("zoomend", renderMarkers);
    map.on("moveend", renderMarkers);
    const reportCenter = () => {
      const c = map.getCenter();
      onCenterChangeRef.current?.({ lat: c.lat, lng: c.lng });
    };
    map.on("moveend", reportCenter);
    map.on("load", reportCenter);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [renderMarkers]);

  useEffect(() => {
    usersRef.current = users;
    eventsRef.current = events;
    renderMarkers();
  }, [users, events, renderMarkers]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.easeTo({
      center: [focus.lng, focus.lat],
      zoom: Math.min(9, MAX_ZOOM),
      duration: 800,
    });
  }, [focus]);

  return (
    <div className="relative h-full w-full bg-[#05070f]">
      <div ref={containerRef} className="h-full w-full" />
      <div className="stars-overlay" aria-hidden />
    </div>
  );
}
