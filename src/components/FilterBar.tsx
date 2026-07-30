"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";

/** Map display filters: checked = shown. Gender applies to humans that share
 *  it (hidden genders always show); bots and events toggle whole layers. */
export interface MapFilterState {
  male: boolean;
  female: boolean;
  other: boolean;
  bots: boolean;
  events: boolean;
}

export const DEFAULT_FILTERS: MapFilterState = {
  male: true,
  female: true,
  other: true,
  bots: true,
  events: true,
};

const STORAGE_KEY = "mapFilters";

export function loadFilters(): MapFilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<MapFilterState>) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(f: MapFilterState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {}
}

function CheckRow({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="pressable flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-white/[0.06]"
    >
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border text-[11px] font-black transition-colors ${
          checked
            ? "border-indigo-400 bg-indigo-500 text-white"
            : "border-white/25 bg-white/[0.04] text-transparent"
        }`}
      >
        ✓
      </span>
      <span className="text-[13px] font-medium text-slate-200">{label}</span>
    </button>
  );
}

/** Checkbox filter card, anchored top-left. */
export function FilterPanel({
  filters,
  onChange,
}: {
  filters: MapFilterState;
  onChange: (f: MapFilterState) => void;
}) {
  const { t } = useI18n();
  const flip = (k: keyof MapFilterState) => onChange({ ...filters, [k]: !filters[k] });

  return (
    <div className="glass-strong fade-in w-[190px] rounded-[20px] p-2">
      <CheckRow
        checked={filters.male}
        label={`♂ ${t("profile.gender.male")}`}
        onToggle={() => flip("male")}
      />
      <CheckRow
        checked={filters.female}
        label={`♀ ${t("profile.gender.female")}`}
        onToggle={() => flip("female")}
      />
      <CheckRow
        checked={filters.other}
        label={`⚧ ${t("profile.gender.other")}`}
        onToggle={() => flip("other")}
      />
      <div className="mx-2 my-1 border-t border-white/[0.07]" />
      <CheckRow
        checked={filters.bots}
        label={`🤖 ${t("nearby.bot")}`}
        onToggle={() => flip("bots")}
      />
      <CheckRow
        checked={filters.events}
        label={`📅 ${t("tab.events")}`}
        onToggle={() => flip("events")}
      />
    </div>
  );
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Find a user by pasting a wallet address; opens their profile card. */
export function AddressSearch({ onFound }: { onFound: (address: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [bad, setBad] = useState(false);

  function submit(value?: string) {
    const a = (value ?? q).trim();
    if (!ADDRESS_RE.test(a)) {
      setBad(true);
      return;
    }
    setBad(false);
    setQ("");
    onFound(a.toLowerCase());
  }

  /** One-tap paste: read the clipboard and search immediately if it holds
   *  a wallet address (mobile wallets make manual paste awkward). */
  async function pasteAndSearch() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      setQ(text);
      submit(text);
    } catch {
      setBad(true);
    }
  }

  return (
    <div
      className={`glass flex items-center gap-1.5 rounded-full py-1.5 pl-3.5 pr-1.5 transition-shadow ${
        bad ? "ring-2 ring-red-400/60" : ""
      }`}
    >
      <span className="text-xs opacity-70">🔍</span>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (bad) setBad(false);
        }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={t("search.ph")}
        spellCheck={false}
        autoCapitalize="off"
        className="w-[150px] bg-transparent font-mono text-xs text-slate-200 outline-none placeholder:font-sans placeholder:text-slate-500"
      />
      <button
        onClick={pasteAndSearch}
        className="icon-btn shrink-0 !h-6 !w-6 !text-[11px]"
        aria-label="Paste"
        title="Paste"
      >
        📋
      </button>
      <button
        onClick={() => submit()}
        className="icon-btn shrink-0 !h-6 !w-6 !text-[10px]"
        aria-label="Search"
      >
        →
      </button>
    </div>
  );
}
