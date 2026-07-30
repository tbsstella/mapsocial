export interface Country {
  code: string;
  name: string;
  lat: number;
  lng: number;
  /** Distance unit convention; defaults to km. */
  unit?: "mi";
}

/** Country centroids used when a user shares only country-level location. */
export const COUNTRIES: Country[] = [
  { code: "US", name: "United States", lat: 39.8, lng: -98.6, unit: "mi" },
  { code: "CN", name: "China", lat: 35.9, lng: 104.2 },
  { code: "JP", name: "Japan", lat: 36.2, lng: 138.3 },
  { code: "KR", name: "South Korea", lat: 36.5, lng: 127.9 },
  { code: "SG", name: "Singapore", lat: 1.35, lng: 103.82 },
  { code: "HK", name: "Hong Kong", lat: 22.35, lng: 114.14 },
  { code: "TW", name: "Taiwan", lat: 23.7, lng: 121.0 },
  { code: "GB", name: "United Kingdom", lat: 54.0, lng: -2.5, unit: "mi" },
  { code: "DE", name: "Germany", lat: 51.1, lng: 10.4 },
  { code: "FR", name: "France", lat: 46.6, lng: 2.4 },
  { code: "NL", name: "Netherlands", lat: 52.2, lng: 5.5 },
  { code: "CH", name: "Switzerland", lat: 46.8, lng: 8.2 },
  { code: "ES", name: "Spain", lat: 40.4, lng: -3.6 },
  { code: "IT", name: "Italy", lat: 42.8, lng: 12.6 },
  { code: "PT", name: "Portugal", lat: 39.6, lng: -8.0 },
  { code: "SE", name: "Sweden", lat: 62.2, lng: 17.6 },
  { code: "NO", name: "Norway", lat: 64.5, lng: 11.5 },
  { code: "PL", name: "Poland", lat: 52.1, lng: 19.4 },
  { code: "UA", name: "Ukraine", lat: 48.9, lng: 31.5 },
  { code: "TR", name: "Turkey", lat: 39.0, lng: 35.2 },
  { code: "AE", name: "UAE", lat: 24.3, lng: 54.3 },
  { code: "SA", name: "Saudi Arabia", lat: 24.0, lng: 45.0 },
  { code: "IL", name: "Israel", lat: 31.4, lng: 35.0 },
  { code: "IN", name: "India", lat: 22.9, lng: 79.6 },
  { code: "ID", name: "Indonesia", lat: -2.5, lng: 118.0 },
  { code: "TH", name: "Thailand", lat: 15.0, lng: 101.0 },
  { code: "VN", name: "Vietnam", lat: 16.0, lng: 107.8 },
  { code: "PH", name: "Philippines", lat: 12.9, lng: 121.8 },
  { code: "MY", name: "Malaysia", lat: 3.8, lng: 109.7 },
  { code: "AU", name: "Australia", lat: -25.7, lng: 134.5 },
  { code: "NZ", name: "New Zealand", lat: -41.8, lng: 171.5 },
  { code: "CA", name: "Canada", lat: 61.4, lng: -98.3 },
  { code: "MX", name: "Mexico", lat: 23.9, lng: -102.5 },
  { code: "BR", name: "Brazil", lat: -10.8, lng: -53.1 },
  { code: "AR", name: "Argentina", lat: -35.4, lng: -65.2 },
  { code: "CL", name: "Chile", lat: -37.7, lng: -71.4 },
  { code: "CO", name: "Colombia", lat: 4.1, lng: -73.1 },
  { code: "NG", name: "Nigeria", lat: 9.6, lng: 8.1 },
  { code: "ZA", name: "South Africa", lat: -29.0, lng: 25.1 },
  { code: "EG", name: "Egypt", lat: 26.6, lng: 29.9 },
  { code: "KE", name: "Kenya", lat: 0.5, lng: 37.9 },
  { code: "RU", name: "Russia", lat: 61.5, lng: 105.3 },
  { code: "KZ", name: "Kazakhstan", lat: 48.2, lng: 66.9 },
  { code: "OTHER", name: "Other", lat: 0, lng: 0 },
];

export function countryByCode(code: string | null): Country | undefined {
  if (!code) return undefined;
  return COUNTRIES.find((c) => c.code === code);
}

/**
 * Offline fallback for country auto-fill: nearest centroid from the supported
 * list. Coarse near borders, but only used when reverse geocoding fails.
 */
export function nearestCountry(lat: number, lng: number): Country | undefined {
  let best: Country | undefined;
  let bestD = Infinity;
  for (const c of COUNTRIES) {
    if (c.code === "OTHER") continue;
    const dLat = c.lat - lat;
    const dLng = (c.lng - lng) * Math.cos((lat * Math.PI) / 180);
    const d = dLat * dLat + dLng * dLng;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}
