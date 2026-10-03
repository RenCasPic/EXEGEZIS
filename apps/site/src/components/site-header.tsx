import { Menu } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { HeaderActions } from "./header-actions";
import { LanguageSwitcher } from "./language-switcher";
import { Container, LogoMark } from "./ui";

const SECTIONS = [
  ["product", "#product"],
  ["how", "#how"],
  ["pricing", "#pricing"],
  ["faq", "#faq"],
] as const;

/**
 * Navy header, 72 px: logo · Product · How it works · Pricing · Questions ·
 * (language) · Sign in · Start for free. On a phone the sections go into a menu.
 */
export function SiteHeader({ locale }: { locale: Locale }) {
  const t = useTranslations("nav");
  return (
    <header className="theme-dark sticky top-0 z-30 border-b border-line bg-bg">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">
        {t("skip")}
      </a>
      <Container className="flex h-16 items-center justify-between gap-3 md:h-[72px]">
        <div className="flex items-center gap-12">
          <a href={`/${locale}/`} aria-label={t("home")} className="flex shrink-0 items-center gap-2.5 rounded-md text-heading">
            <LogoMark className="size-6 text-fg" />
            <span className="font-mono text-[16px] font-semibold tracking-[0.16em]">EXEGEZIS</span>
          </a>
          <nav aria-label={t("main")} className="hidden items-center gap-8 text-[15px] lg:flex">
            {SECTIONS.map(([key, href]) => (
              <a key={key} href={href} className="text-text-soft hover:text-heading">
                {t(key)}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LanguageSwitcher locale={locale} />
          <HeaderActions locale={locale} />
          <details className="relative lg:hidden">
            <summary aria-label={t("menu")} className="grid size-10 cursor-pointer place-items-center rounded-md text-heading hover:bg-hover">
              <Menu className="size-5" aria-hidden />
            </summary>
            <nav aria-label={t("main")} className="panel-frame absolute right-0 mt-2 flex w-60 flex-col gap-1 rounded-xl bg-panel p-2">
              {SECTIONS.map(([key, href]) => (
                <a key={key} href={href} className="rounded-md px-3 py-2 text-[15px] text-heading hover:bg-hover">
                  {t(key)}
                </a>
              ))}
              <HeaderActions locale={locale} menu />
            </nav>
          </details>
        </div>
      </Container>
    </header>
  );
}
