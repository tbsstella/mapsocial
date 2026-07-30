export type DistanceUnit = "km" | "mi";

/** Great-circle distance in km between two points. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface DistanceParts {
  /** Rounded display value in the viewer's unit. */
  n: string;
  /** True when the distance is below the smallest bucket ("within ~10"). */
  within: boolean;
}

/**
 * Coarse, bucketed distance in the viewer's unit. All stored coordinates are
 * already fuzzed (~11 km grid or country centroid), so values stay approximate
 * by design. Rendering (约/~, 公里/km/mi) is handled by the i18n layer.
 */
export function distanceParts(km: number, unit: DistanceUnit): DistanceParts {
  const v = unit === "mi" ? km * 0.621371 : km;
  if (v < 15) return { n: "10", within: true };
  let rounded: number;
  if (v < 100) rounded = Math.round(v / 10) * 10;
  else if (v < 1000) rounded = Math.round(v / 50) * 50;
  else rounded = Math.round(v / 100) * 100;
  return { n: rounded.toLocaleString(), within: false };
}
