"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en, type Strings } from "@/locales/en";
import { id } from "@/locales/id";
import { ru } from "@/locales/ru";
import { ar } from "@/locales/ar";
import { zh } from "@/locales/zh";
import type { LocaleDict } from "@/locales/types";

export type Locale = "en" | "id" | "ru" | "ar" | "zh";

const dictionaries: Record<Locale, LocaleDict> = { en, id, ru, ar, zh };
const RTL_LOCALES: Locale[] = ["ar"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merge a partial locale over the EN base so missing keys fall back to English. */
function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(
      (base as Record<string, unknown>)[key],
      (override as Record<string, unknown>)[key],
    );
  }
  return out as T;
}

function resolveStrings(locale: Locale): Strings {
  if (locale === "en") return en;
  return deepMerge(en, dictionaries[locale]);
}

interface StringsContextValue {
  strings: Strings;
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
}

const StringsContext = createContext<StringsContextValue | null>(null);

export function StringsProvider({
  children,
  initialLocale = "en",
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const dir: "ltr" | "rtl" = RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
  const strings = useMemo(() => resolveStrings(locale), [locale]);

  // Keep <html lang/dir> in sync so RTL (ar) flips the whole document.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const value = useMemo<StringsContextValue>(
    () => ({ strings, locale, dir, setLocale }),
    [strings, locale, dir],
  );

  return (
    <StringsContext.Provider value={value}>{children}</StringsContext.Provider>
  );
}

/** Typed access to copy + locale controls. */
export function useStrings(): StringsContextValue {
  const ctx = useContext(StringsContext);
  if (!ctx) {
    throw new Error("useStrings must be used within <StringsProvider>");
  }
  return ctx;
}
