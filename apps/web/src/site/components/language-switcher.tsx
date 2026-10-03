"use client";

import { SITE_LOCALE_NAME, SITE_LOCALES, SITE_PATHS, siteT, type SiteLocale, type SitePage } from "../i18n";

/**
 * EN / ES: the same page in the other language (/producto ↔ /product…). The
 * choice is also the app's language cookie, so the app, sign-in and `/`
 * follow it.
 */
export function LanguageSwitcher({ locale, page }: { locale: SiteLocale; page: SitePage }) {
  const t = siteT(locale, "language");
  const remember = (l: SiteLocale) => {
    document.cookie = `EXEGEZIS_LOCALE=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };
  return (
    <nav aria-label={t("label")} className="flex items-center gap-1 font-mono text-[13px]">
      {SITE_LOCALES.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-muted" aria-hidden>
              /
            </span>
          )}
          <a
            href={SITE_PATHS[page][l]}
            lang={l}
            hrefLang={l}
            title={SITE_LOCALE_NAME[l]}
            aria-current={l === locale ? "true" : undefined}
            onClick={() => remember(l)}
            className={`rounded px-1 uppercase ${l === locale ? "text-heading" : "text-muted hover:text-heading"}`}
          >
            {l}
            <span className="sr-only"> · {SITE_LOCALE_NAME[l]}</span>
          </a>
        </span>
      ))}
    </nav>
  );
}
