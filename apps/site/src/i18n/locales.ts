/*
 * Languages of the public site. The language is part of the URL (/en/, /es/),
 * so the site can be a static export. No imports: safe in the browser.
 */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The visitor's explicit choice (the language switcher), kept in this browser. */
export const LOCALE_STORAGE_KEY = "exegezis-site-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The first supported language in the browser's list (navigator.languages), else English. */
export function preferredLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

export const LOCALE_NAME: Record<Locale, string> = { en: "English", es: "Español" };
