"use client";

import { useRef, useState } from "react";
import { AVATAR_CUSTOM, AVATAR_DEFAULT } from "@/lib/avatars";
import { cropToDataUrl } from "@/lib/avatarupload";
import { Avatar } from "./Avatar";
import { apiErrorText, useI18n, LANGS } from "@/lib/i18n";
import type { Me } from "@/hooks/useMe";

interface FormState {
  username: string;
  avatar: string;
  gender: string;
  bio: string;
  link: string;
  profileVisibility: string;
  genderVisibility: string;
  assetsVisibility: string;
  locationMode: string;
  messagingAllowed: boolean;
  lat: number | null;
  lng: number | null;
}

function Toggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="text-sm font-medium text-slate-200">{label}</div>
      <div className="seg shrink-0">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`seg-item !flex-none ${value === o.value ? "seg-item-active" : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const inputCls = "field mt-1.5";

export function ProfileForm({
  me,
  onSaved,
  submitLabel,
}: {
  me: Me;
  onSaved: () => void;
  submitLabel: string;
}) {
  const { t, lang, setLang } = useI18n();
  const p = me.profile;
  const [f, setF] = useState<FormState>({
    username: p?.username ?? "",
    avatar: p?.avatar ?? AVATAR_DEFAULT,
    gender: p?.gender ?? "other",
    bio: p?.bio ?? "",
    link: p?.link ?? "",
    profileVisibility: p?.profile_visibility ?? "visible",
    genderVisibility: p?.gender_visibility ?? "visible",
    assetsVisibility: p?.assets_visibility ?? "blurred",
    locationMode: p?.location_mode ?? "country",
    messagingAllowed: (p?.messaging_allowed ?? 1) === 1,
    lat: p?.lat ?? null,
    lng: p?.lng ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locStatus, setLocStatus] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState<string | null>(p?.avatar_url ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  async function uploadAvatar(file: File) {
    setError(null);
    setUploading(true);
    try {
      const dataUrl = await cropToDataUrl(file);
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorText(data, t));
      setCustomUrl(data.url);
      set("avatar", AVATAR_CUSTOM);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("form.uploadFail"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function requestLocation() {
    setLocStatus(t("form.locGetting"));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Round client-side before it ever leaves the device (~11 km grid).
        const lat = Math.round(pos.coords.latitude * 10) / 10;
        const lng = Math.round(pos.coords.longitude * 10) / 10;
        set("lat", lat);
        set("lng", lng);
        setLocStatus(t("form.locGot"));
      },
      () => setLocStatus(t("form.locFail"))
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorText(data, t));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("form.saveFail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Avatar: 🔮 by default, replaced only by a user upload */}
      <div>
        <label className="text-sm font-medium text-slate-200">{t("form.avatar")}</label>
        <div className="mt-2 flex items-center gap-3">
          <Avatar
            id={f.avatar === AVATAR_CUSTOM && customUrl ? AVATAR_CUSTOM : f.avatar}
            url={customUrl}
            size={56}
            ring
            gender={f.gender}
          />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="pressable rounded-full border border-white/15 bg-white/[0.05] px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              {uploading ? t("form.uploading") : t("form.uploadAvatar")}
            </button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadAvatar(file);
          }}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-200">{t("form.username")}</label>
        <input
          value={f.username}
          onChange={(e) => set("username", e.target.value)}
          placeholder={t("form.usernamePh")}
          className={inputCls}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-200">
          {t("form.gender")}
          {p && <span className="ml-1.5 text-[11px] text-slate-500">🔒 {t("form.genderLocked")}</span>}
        </label>
        <div className="seg mt-1.5">
          {(["male", "female", "other"] as const).map((g) => (
            <button
              key={g}
              type="button"
              disabled={!!p}
              onClick={() => set("gender", g)}
              className={`seg-item py-2 ${f.gender === g ? "seg-item-active" : ""} ${
                p && f.gender !== g ? "opacity-30" : ""
              }`}
            >
              {t(`profile.gender.${g}`)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium text-slate-200">{t("form.bio")}</label>
        <textarea
          value={f.bio}
          onChange={(e) => set("bio", e.target.value.slice(0, 280))}
          rows={3}
          placeholder={t("form.bioPh")}
          className={`${inputCls} resize-none`}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-slate-200">{t("form.link")}</label>
        <input
          value={f.link}
          onChange={(e) => set("link", e.target.value)}
          placeholder="https://…"
          className={inputCls}
        />
      </div>

      {/* Permissions (location share lives here too: one toggle, no own section) */}
      <div className="inset-group p-4">
        <div className="text-sm font-semibold text-slate-200">{t("form.perms")}</div>
        <Toggle
          label={t("form.locShare")}
          options={[
            { value: "approx", label: t("form.share") },
            { value: "country", label: t("form.noShare") },
          ]}
          value={f.locationMode}
          onChange={(v) => set("locationMode", v)}
        />
        {f.locationMode === "approx" ? (
          <div className="pb-2.5">
            <button
              type="button"
              onClick={requestLocation}
              className="pressable rounded-full border border-white/15 bg-white/[0.05] px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
            >
              {t("form.getLoc")}
            </button>
            {locStatus && <span className="ml-2 text-xs text-slate-500">{locStatus}</span>}
            {f.lat != null && (
              <span className="ml-2 text-xs tabular-nums text-slate-500">
                ({f.lat.toFixed(1)}, {f.lng?.toFixed(1)})
              </span>
            )}
          </div>
        ) : null}
        <Toggle
          label={t("form.visibility")}
          options={[
            { value: "visible", label: t("form.visible") },
            { value: "hidden", label: t("form.hidden") },
          ]}
          value={f.profileVisibility}
          onChange={(v) => set("profileVisibility", v)}
        />
        <Toggle
          label={t("form.genderVis")}
          options={[
            { value: "visible", label: t("form.visible") },
            { value: "hidden", label: t("form.hidden") },
          ]}
          value={f.genderVisibility}
          onChange={(v) => set("genderVisibility", v)}
        />
        <Toggle
          label={t("form.assetsVis")}
          options={[
            { value: "visible", label: t("form.visible") },
            { value: "blurred", label: t("form.blurredOpt") },
            { value: "hidden", label: t("form.hidden") },
          ]}
          value={f.assetsVisibility}
          onChange={(v) => set("assetsVisibility", v)}
        />
        <Toggle
          label={t("form.dm")}
          options={[
            { value: "allow", label: t("form.allow") },
            { value: "deny", label: t("form.deny") },
          ]}
          value={f.messagingAllowed ? "allow" : "deny"}
          onChange={(v) => set("messagingAllowed", v === "allow")}
        />
        <div className="flex items-center justify-between gap-3 py-2.5">
          <div className="text-sm font-medium text-slate-200">{t("form.language")}</div>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as typeof lang)}
            className="rounded-full border border-white/10 bg-[#0d1220] px-3 py-1.5 text-xs font-semibold text-slate-100 outline-none focus:border-indigo-400"
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button onClick={submit} disabled={busy || !f.username} className="btn-primary py-3.5">
        {busy ? t("form.saving") : submitLabel}
      </button>
    </div>
  );
}
