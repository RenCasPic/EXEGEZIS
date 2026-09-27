/*
 * Languages of the UI (docs/11-i18n.md). No imports: safe in the browser.
 */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "EXEGEZIS_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * The cookie wins; otherwise the first supported language of the browser
 * (Accept-Language, in the order and weights it gives); otherwise English.
 */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => /^q=([\d.]+)$/.exec(p.trim())?.[1]).find((v) => v !== undefined);
      return { lang: tag.toLowerCase().split("-")[0] ?? "", q: q === undefined ? 1 : Number(q), index };
    })
    .filter((x) => x.lang !== "" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked.map((x) => x.lang).find(isLocale) ?? DEFAULT_LOCALE;
}

export const LOCALE_NAME: Record<Locale, string> = { en: "English", es: "Español" };
