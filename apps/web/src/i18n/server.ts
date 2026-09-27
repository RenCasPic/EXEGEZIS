import { getLocale } from "next-intl/server";
import { formatFor, type Format } from "./format";
import { isLocale, DEFAULT_LOCALE, type Locale } from "./locales";

export async function getUiLocale(): Promise<Locale> {
  const l = await getLocale();
  return isLocale(l) ? l : DEFAULT_LOCALE;
}

/** Formatters for the request's language (Server Components). */
export async function getFormat(): Promise<Format> {
  return formatFor(await getUiLocale());
}
