import { useLocale } from "next-intl";
import { formatFor, type Format } from "./format";
import { DEFAULT_LOCALE, isLocale } from "./locales";

/**
 * Formatters for the active language, in any synchronous component (Server or
 * Client): useLocale works in both. Async Server Components use getFormat().
 */
export function useFormat(): Format {
  const l = useLocale();
  return formatFor(isLocale(l) ? l : DEFAULT_LOCALE);
}
