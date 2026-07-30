"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiErrorText, useI18n } from "@/lib/i18n";
import {
  ApiDocCard,
  AvatarUploader,
  CreatePanelShell,
  SHOW_SDK,
  SimnRow,
  StakeCard,
  TIER_BOT,
  useLicense,
} from "./CreateShared";

/** Integration contract, phrased for both developers and AI agents. */
const BOT_API_DOC = `MapSocial Bot API (cookie session via SIWE login, bot wallet)
Licensing (enforced server-side, same for UI/API/SDK):
  replying requires an active bot stake position
  (tier 2, LicenseStake, 1000 SIMN); bots never initiate DMs.
GET /api/license                 # your positions, prices, contract addr
Option A — zero code: PUT /api/bot/config
  { apiUrl: "https://.../v1",   # any OpenAI-compatible endpoint
    apiKey?, model, systemPrompt?, enabled: true }
  -> incoming DMs are auto-answered by your model
Option B — full control (pricing/logic all yours):
  GET  /api/threads             # incoming chats
  GET  /api/threads/:id         # messages in a thread
  POST /api/threads/:id         # reply { "body": "..." }
SDK (Node, wraps SIWE login + all calls): sdk/mapsocial.mjs
  const ms = new MapSocial({ baseUrl });
  await ms.login(key, { accountType: "bot" });
  await ms.reply(threadId, "hi")`;

interface BotConfig {
  apiUrl: string;
  hasApiKey: boolean;
  model: string;
  systemPrompt: string;
  enabled: boolean;
}

/**
 * Bot operator panel. Deliberately just "an opening": the platform provides
 * the chat window; the operator plugs in their own conversational bot.
 *  - Zero-code path: any OpenAI-compatible endpoint (auto-reply).
 *  - Full-control path: the open API/SDK — the bot wallet logs in via SIWE
 *    and polls/replies itself; pricing & business logic are the operator's.
 */
export function CreateBotSheet({
  isBot,
  onBack,
  onClose,
}: {
  isBot: boolean;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: lic } = useLicense();

  const { data: cfg } = useQuery<BotConfig>({
    queryKey: ["botConfig"],
    queryFn: async () => (await fetch("/api/bot/config")).json(),
    enabled: isBot,
  });

  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [persona, setPersona] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // With the SDK hidden, the zero-code path is the only integration path,
  // so it starts expanded; otherwise it's a collapsed secondary option.
  const [noCodeOpen, setNoCodeOpen] = useState(!SHOW_SDK);

  // Hydrate the form once from the stored config (render-time adjustment).
  if (cfg && !loaded) {
    setApiUrl(cfg.apiUrl);
    setModel(cfg.model);
    setPersona(cfg.systemPrompt);
    setEnabled(cfg.enabled);
    if (cfg.enabled || cfg.apiUrl) setNoCodeOpen(true);
    setLoaded(true);
  }

  async function save() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/bot/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl, apiKey, model, systemPrompt: persona, enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorText(data, t));
      setApiKey("");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("err.GENERIC"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <CreatePanelShell
      title={t("create.newBot")}
      subtitle={t("create.botHint")}
      onBack={onBack}
      onClose={onClose}
    >
      <SimnRow />

      {!isBot && (
        <p className="inset-group px-4 py-3 text-xs leading-relaxed text-amber-300">
          🤖 {t("create.botNotBot")}
        </p>
      )}

      {lic && (
        <StakeCard
          tier={TIER_BOT}
          status={lic.bot}
          contract={lic.contract}
          referrer={lic.inviterAddress}
          heading={t("create.bot")}
          hint={t("create.feeNote")}
        />
      )}

      {isBot && <AvatarUploader kind="bot" />}

      {SHOW_SDK && (
        <ApiDocCard title={t("create.sdkTitle")} hint={t("create.sdkHint")} doc={BOT_API_DOC} />
      )}

      {isBot && (
        <div className="inset-group p-4">
          <button
            onClick={() => setNoCodeOpen((v) => !v)}
            className="flex w-full items-center justify-between"
          >
            <span className="text-sm font-bold">⚡ {t("create.noCode")}</span>
            <span className="text-slate-500">{noCodeOpen ? "−" : "+"}</span>
          </button>
          {noCodeOpen && (
            <>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                {t("create.aiHint")}
              </p>

              <div className="mt-3 flex flex-col gap-2">
                <input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder={t("create.apiUrlPh")}
                  className="field !py-2 font-mono !text-xs"
                />
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  type="password"
                  placeholder={cfg?.hasApiKey ? t("create.apiKeySavedPh") : t("create.apiKeyPh")}
                  className="field !py-2 font-mono !text-xs"
                />
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={t("create.modelPh")}
                  className="field !py-2 font-mono !text-xs"
                />
                <textarea
                  value={persona}
                  onChange={(e) => setPersona(e.target.value.slice(0, 2000))}
                  placeholder={t("create.personaPh")}
                  rows={3}
                  className="field resize-none !py-2 text-sm"
                />

                <label className="flex cursor-pointer items-center justify-between py-1">
                  <span className="text-sm font-medium text-slate-200">
                    {t("create.enabled")}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => setEnabled((v) => !v)}
                    className={`pressable relative h-7 w-12 rounded-full transition-colors ${
                      enabled ? "bg-emerald-500" : "bg-white/10"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                        enabled ? "left-[22px]" : "left-0.5"
                      }`}
                    />
                  </button>
                </label>

                {saved && (
                  <p className="rounded-xl bg-emerald-400/10 px-3 py-1.5 text-[11px] text-emerald-300">
                    {t("create.botSaved")}
                  </p>
                )}
                {error && <p className="text-xs text-red-400">{error}</p>}
                <button onClick={save} disabled={saving} className="btn-primary py-2.5 text-xs">
                  {saving ? t("form.saving") : t("form.save")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </CreatePanelShell>
  );
}
