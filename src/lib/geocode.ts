/**
 * Client-side geocoding via OSM Nominatim (free, no key; low volume only).
 * Used by event creation to turn the map center into a street address and
 * a typed address into precise coordinates.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export async function reverseGeocode(p: GeoPoint, lang: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lng}&accept-language=${lang}`
    );
    if (!r.ok) return null;
    const d = (await r.json()) as { display_name?: unknown };
    return typeof d.display_name === "string" ? d.display_name : null;
  } catch {
    return null;
  }
}

export async function forwardGeocode(
  q: string,
  lang: string
): Promise<(GeoPoint & { label: string }) | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}&accept-language=${lang}`
    );
    if (!r.ok) return null;
    const d = (await r.json()) as { lat?: string; lon?: string; display_name?: string }[];
    const hit = Array.isArray(d) ? d[0] : null;
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, label: String(hit.display_name ?? q) };
  } catch {
    return null;
  }
}
