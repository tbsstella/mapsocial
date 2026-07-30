"use client";

import { useI18n } from "@/lib/i18n";

export function trustColor(score: number): string {
  if (score >= 80) return "#34d399";
  if (score >= 60) return "#a3e635";
  if (score >= 30) return "#fbbf24";
  return "#f87171";
}

export function TrustBadge({ score }: { score: number }) {
  const { t } = useI18n();
  const color = trustColor(score);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums"
      style={{
        color,
        background: `${color}1a`,
        border: `1px solid ${color}55`,
        boxShadow: `0 0 10px ${color}33`,
      }}
      title={t("trust.badgeTitle")}
    >
      ★ {score}
    </span>
  );
}
