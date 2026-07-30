"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { CreatePanelShell, SimnRow } from "./CreateShared";
import { CreateEventSheet } from "./CreateEventSheet";
import { CreateBotSheet } from "./CreateBotSheet";

type Mode = "menu" | "event" | "bot";

/** Creator hub entry: chooser between the two separate creator panels. */
export function CreateSheet({
  center,
  isBot,
  onClose,
  onCreated,
}: {
  center: { lat: number; lng: number } | null;
  isBot: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  // Bot accounts land straight in the bot panel; humans get the chooser.
  const [mode, setMode] = useState<Mode>(isBot ? "bot" : "menu");

  if (mode === "event")
    return (
      <CreateEventSheet
        center={center}
        onBack={() => setMode("menu")}
        onClose={onClose}
        onCreated={onCreated}
      />
    );

  if (mode === "bot")
    return (
      <CreateBotSheet
        isBot={isBot}
        onBack={isBot ? undefined : () => setMode("menu")}
        onClose={onClose}
      />
    );

  return (
    <CreatePanelShell title={t("create.title")} onClose={onClose}>
      <SimnRow />

      <button
        onClick={() => setMode("event")}
        className="pressable inset-group flex items-center gap-3.5 p-4 text-left hover:bg-white/[0.07]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-gradient-to-br from-indigo-500/25 to-violet-500/25 text-xl">
          📅
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{t("create.newEvent")}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
            {t("create.menuEventDesc")}
          </span>
        </span>
        <span className="text-slate-600">›</span>
      </button>

      <button
        onClick={() => setMode("bot")}
        className="pressable inset-group flex items-center gap-3.5 p-4 text-left hover:bg-white/[0.07]"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-gradient-to-br from-emerald-500/25 to-cyan-500/25 text-xl">
          🤖
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{t("create.newBot")}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
            {t("create.menuBotDesc")}
          </span>
        </span>
        <span className="text-slate-600">›</span>
      </button>

      <p className="px-1 text-[10px] leading-relaxed text-slate-600">
        {t("create.feeNote")}
      </p>
    </CreatePanelShell>
  );
}
