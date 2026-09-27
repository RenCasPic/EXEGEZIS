"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import { formatFor, type Format } from "./format";
import { DEFAULT_LOCALE, isLocale } from "./locales";

/** Formatters for the active language (Client Components). */
export function useFormat(): Format {
  const l = useLocale();
  return useMemo(() => formatFor(isLocale(l) ? l : DEFAULT_LOCALE), [l]);
}
