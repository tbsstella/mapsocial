import { avatarById } from "@/lib/avatars";

export type AvatarKind = "human" | "organizer" | "bot";

/** Derive the avatar shape from user role flags (bot wins over organizer). */
export function avatarKind(accountType?: string | null, isOrganizer?: boolean): AvatarKind {
  if (accountType === "bot") return "bot";
  if (isOrganizer) return "organizer";
  return "human";
}

/** Gender accent: corner symbol + ring color (humans only, when shared). */
const GENDER_META: Record<string, { symbol: string; color: string }> = {
  male: { symbol: "♂", color: "#38bdf8" },
  female: { symbol: "♀", color: "#fb7185" },
  other: { symbol: "⚧", color: "#a78bfa" },
};

/**
 * Role-shaped avatar:
 *  - human     → circle; gender (if shared) shows as a colored corner badge,
 *                and the ring (when enabled) takes the gender color
 *  - organizer → rounded square (active event creators)
 *  - bot       → circle with an "AI" corner badge
 */
export function Avatar({
  id,
  url,
  size = 40,
  ring,
  kind = "human",
  gender,
}: {
  id: string;
  /** Custom avatar image URL (profiles.avatar_url); rendered when present. */
  url?: string | null;
  size?: number;
  ring?: boolean;
  kind?: AvatarKind;
  gender?: string | null;
}) {
  const g = kind === "human" && gender ? GENDER_META[gender] : undefined;
  const ringStyle = ring
    ? { boxShadow: `0 0 0 2px ${g?.color ?? "#ffffff"}, 0 4px 12px rgba(0,0,0,.35)` }
    : undefined;
  const radius = kind === "organizer" ? Math.round(size * 0.28) : size;

  let face: React.ReactNode;
  if (id === "custom" && url) {
    face = (
      // eslint-disable-next-line @next/next/no-img-element -- runtime-uploaded file, not a build asset
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="object-cover select-none"
        style={{ width: size, height: size, borderRadius: radius, ...ringStyle }}
      />
    );
  } else {
    const a = avatarById(id);
    face = (
      <div
        className="flex items-center justify-center select-none"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          fontSize: size * 0.52,
          background: `linear-gradient(135deg, ${a.from}, ${a.to})`,
          ...ringStyle,
        }}
      >
        {a.emoji}
      </div>
    );
  }

  const badge =
    kind === "bot"
      ? { text: "AI", color: "#6366f1" }
      : g
        ? { text: g.symbol, color: g.color }
        : null;

  if (!badge) return <>{face}</>;

  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {face}
      <span
        aria-hidden
        className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full font-bold leading-none text-white ring-2 ring-[#0d101b]"
        style={{
          background: badge.color,
          fontSize: Math.max(7, size * 0.24),
          minWidth: Math.max(11, size * 0.34),
          padding: `${Math.max(1, size * 0.04)}px ${Math.max(2, size * 0.06)}px`,
        }}
      >
        {badge.text}
      </span>
    </span>
  );
}
