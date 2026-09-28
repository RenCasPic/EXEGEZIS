"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocaleAction } from "@/app/locale-actions";
import { LOCALE_NAME, LOCALES, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/cn";

/**
 * English / Español, next to the theme. Desktop: a segmented control.
 * Mobile: one 44 px button that switches to the other language.
 */
export function LanguageSwitcher() {
  const t = useTranslations("shell.language");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (next: Locale) =>
    start(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  const other = LOCALES.find((l) => l !== locale) ?? "en";
  return (
    <>
      <div role="radiogroup" aria-label={t("label")} className={cn("hidden h-8 items-center rounded-md border border-line bg-panel p-0.5 md:flex", pending && "opacity-60")}>
        {LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={locale === l}
            lang={l}
            onClick={() => choose(l)}
            title={LOCALE_NAME[l]}
            className={cn("flex h-full items-center rounded px-2 text-[12px] transition-colors", locale === l ? "bg-hover text-fg" : "text-muted hover:text-fg")}
          >
            <span className="uppercase xl:hidden" aria-hidden>
              {l}
            </span>
            <span className="sr-only xl:not-sr-only">{LOCALE_NAME[l]}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => choose(other)}
        aria-label={t("cycle", { current: LOCALE_NAME[locale] ?? locale, next: LOCALE_NAME[other] })}
        className="flex size-11 items-center justify-center gap-0.5 rounded-md text-muted hover:bg-hover hover:text-fg md:hidden"
      >
        <Languages className="size-4" aria-hidden />
        <span className="font-mono text-[11px] uppercase" aria-hidden>
          {locale}
        </span>
      </button>
    </>
  );
}
