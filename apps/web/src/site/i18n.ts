import { createTranslator } from "next-intl";
import en from "../../messages/site/en.json";
import es from "../../messages/site/es.json";

/*
 * The public pages (landing, legal) in English and Spanish. Their language
 * comes from the path (/product · /producto…), not from a cookie, so they are
 * static: they use their own catalog (messages/site/<locale>.json) through
 * createTranslator, never the app's request configuration.
 */

export type SiteLocale = "en" | "es";
export const SITE_LOCALES: readonly SiteLocale[] = ["en", "es"];
export const SITE_LOCALE_NAME: Record<SiteLocale, string> = { en: "English", es: "Español" };

export const SITE_MESSAGES = { en, es } as const;
export type SiteMessages = typeof en;

type Namespace = keyof SiteMessages;

/** A translator over one namespace of the site's catalog, in `locale`. Works on the server and in the browser. */
export function siteT<N extends Namespace>(locale: SiteLocale, namespace: N) {
  return createTranslator<SiteMessages, N>({ locale, messages: SITE_MESSAGES[locale], namespace });
}

export { SITE_PATHS, type SitePage } from "./paths";

/** The same page in the other language (for the switcher and hreflang). */
export function otherLocale(locale: SiteLocale): SiteLocale {
  return locale === "es" ? "en" : "es";
}
