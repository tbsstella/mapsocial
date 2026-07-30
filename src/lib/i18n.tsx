"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { zh, type TKey } from "./locales/zh";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { pt } from "./locales/pt";
import { ru } from "./locales/ru";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";

export type { TKey };

const DICTS = { zh, en, es, fr, de, pt, ru, ja, ko } as const;
export type Lang = keyof typeof DICTS;

/** Native-name labels for the language picker. */
export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "ru", label: "Русский" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

function isLang(v: string | null): v is Lang {
  return !!v && v in DICTS;
}

/** Best match for the browser's preferred languages, falling back to English. */
function detectBrowserLang(): Lang {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const prefix = tag.toLowerCase().split("-")[0];
    if (isLang(prefix)) return prefix;
  }
  return "en";
}

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx>({
  lang: "zh",
  setLang: () => {},
  t: (k) => zh[k] ?? k,
});

// Language preference lives in localStorage; useSyncExternalStore keeps every
// consumer in sync (including across tabs) without effect-driven setState.
const langListeners = new Set<() => void>();

function subscribeLang(cb: () => void) {
  langListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    langListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function getLangSnapshot(): Lang {
  const stored = localStorage.getItem("lang");
  if (isLang(stored)) return stored;
  return detectBrowserLang();
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribeLang, getLangSnapshot, () => "zh" as Lang);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem("lang", l);
    langListeners.forEach((cb) => cb());
  }, []);

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => {
      let s = DICTS[lang][key] ?? en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      }
      return s;
    },
    [lang]
  );

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  return useContext(Ctx);
}

/** Localize an API error payload: prefer `code`, fall back to raw `error` text. */
export function apiErrorText(
  data: { code?: string; error?: string } | null | undefined,
  t: I18nCtx["t"]
): string {
  if (data?.code && `err.${data.code}` in zh) return t(`err.${data.code}` as TKey);
  return data?.error ?? t("err.GENERIC");
}
