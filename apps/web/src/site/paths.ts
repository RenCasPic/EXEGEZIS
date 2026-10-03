import type { SiteLocale } from "./i18n";

/** The public pages' paths in each language. */
export const SITE_PATHS = {
  landing: { es: "/producto", en: "/product" },
  privacy: { es: "/privacidad", en: "/privacy" },
  terms: { es: "/terminos", en: "/terms" },
} as const satisfies Record<string, Record<SiteLocale, string>>;

export type SitePage = keyof typeof SITE_PATHS;
