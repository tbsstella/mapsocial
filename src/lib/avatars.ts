/**
 * Avatars come in two flavors:
 *  - The 🔮 default (plus legacy presets kept renderable for old profiles).
 *  - Custom uploads: avatar id "custom" with the image served from
 *    /api/avatar/file/<userId> (see src/app/api/avatar/). Uploads are
 *    resized client-side and pass the moderation hook before being stored.
 */
export interface AvatarPreset {
  id: string;
  emoji: string;
  from: string;
  to: string;
}

/** Every profile starts as 🔮 until the user uploads their own image. */
export const AVATAR_DEFAULT = "default";

// First entry is the default (also the fallback for unknown ids).
// The a01–a12 set is legacy: no longer offered, still rendered.
export const AVATARS: AvatarPreset[] = [
  { id: AVATAR_DEFAULT, emoji: "🔮", from: "#6d28d9", to: "#e879f9" },
  { id: "a01", emoji: "🚀", from: "#4f46e5", to: "#818cf8" }, // to the moon
  { id: "a02", emoji: "💎", from: "#0891b2", to: "#67e8f9" }, // diamond hands
  { id: "a03", emoji: "🐋", from: "#1d4ed8", to: "#38bdf8" }, // whale
  { id: "a04", emoji: "🦍", from: "#334155", to: "#818cf8" }, // ape
  { id: "a05", emoji: "🤖", from: "#059669", to: "#6ee7b7" }, // bot
  { id: "a06", emoji: "👾", from: "#7c3aed", to: "#d8b4fe" }, // degen
  { id: "a07", emoji: "🧙", from: "#6d28d9", to: "#a78bfa" }, // wizard
  { id: "a08", emoji: "🥷", from: "#18181b", to: "#71717a" }, // ninja
  { id: "a09", emoji: "🦊", from: "#ea580c", to: "#fbbf24" }, // fox
  { id: "a10", emoji: "🐸", from: "#16a34a", to: "#a3e635" }, // frog
  { id: "a11", emoji: "⚡", from: "#ca8a04", to: "#fde047" }, // gas
  { id: "a12", emoji: "🔮", from: "#be185d", to: "#e879f9" }, // oracle
];

export const AVATAR_IDS = AVATARS.map((a) => a.id);

/** Custom uploaded avatar marker (image lives in profiles.avatar_url). */
export const AVATAR_CUSTOM = "custom";

export function avatarById(id: string): AvatarPreset {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}
