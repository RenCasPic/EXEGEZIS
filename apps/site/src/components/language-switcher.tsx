"use client";

import { useTranslations } from "next-intl";
import { LOCALE_NAME, LOCALE_STORAGE_KEY, LOCALES, type Locale } from "@/i18n/locales";

/**
 * EN / ES (not in the design: it has one language). Each language is its own
 * static page (/en/, /es/); the choice is remembered in this browser so `/`
 * opens it next time.
 */
export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const t = useTranslations("language");
  const remember = (l: Locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, l);
    } catch {
      // Storage unavailable: the link still changes the language.
    }
  };
  return (
    <nav aria-label={t("label")} className="flex items-center gap-1 font-mono text-[13px]">
      {LOCALES.map((l, i) => (
        <span key={l} className="flex items-center gap-1">
          {i > 0 && (
            <span className="text-muted" aria-hidden>
              /
            </span>
          )}
          <a
            href={`/${l}/`}
            lang={l}
            hrefLang={l}
            title={LOCALE_NAME[l]}
            aria-current={l === locale ? "true" : undefined}
            onClick={() => remember(l)}
            className={`rounded px-1 uppercase ${l === locale ? "text-heading" : "text-muted hover:text-heading"}`}
          >
            {l}
            <span className="sr-only"> · {LOCALE_NAME[l]}</span>
          </a>
        </span>
      ))}
    </nav>
  );
}
