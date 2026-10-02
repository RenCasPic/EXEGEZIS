"use client";

import { useTranslations } from "next-intl";
import { LOCALE_NAME, LOCALE_STORAGE_KEY, LOCALES, type Locale } from "@/i18n/locales";

/**
 * English / Español. Each language is its own static page (/en/, /es/); the
 * choice is remembered in this browser so `/` opens it next time.
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
    <nav aria-label={t("label")} className="flex h-9 items-center rounded-md border border-line-strong p-0.5">
      {LOCALES.map((l) => (
        <a
          key={l}
          href={`/${l}/`}
          lang={l}
          hrefLang={l}
          aria-current={l === locale ? "true" : undefined}
          onClick={() => remember(l)}
          className={`flex h-full items-center rounded px-2 text-[13px] font-medium ${l === locale ? "bg-hover text-heading" : "text-muted hover:text-heading"}`}
        >
          <span className="uppercase sm:hidden" aria-hidden>
            {l}
          </span>
          <span className="sr-only sm:not-sr-only">{LOCALE_NAME[l]}</span>
        </a>
      ))}
    </nav>
  );
}
