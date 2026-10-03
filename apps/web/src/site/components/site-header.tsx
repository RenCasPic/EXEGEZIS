import { Menu } from "lucide-react";
import { SITE_PATHS, siteT, type SiteLocale, type SitePage } from "../i18n";
import type { SiteLinks } from "../links";
import { HeaderActions } from "./header-actions";
import { LanguageSwitcher } from "./language-switcher";
import { Container, LogoMark } from "./ui";

const SECTIONS = [
  ["product", "product"],
  ["how", "how"],
  ["pricing", "pricing"],
  ["faq", "faq"],
] as const;

/**
 * Navy header, 72 px: logo · Product · How it works · Pricing · Questions ·
 * (language) · Sign in · Start for free. On a phone the sections go into a menu.
 */
export function SiteHeader({ locale, page, links }: { locale: SiteLocale; page: SitePage; links: SiteLinks }) {
  const t = siteT(locale, "nav");
  const landing = SITE_PATHS.landing[locale];
  return (
    <header className="theme-dark sticky top-0 z-30 border-b border-line bg-bg">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">
        {t("skip")}
      </a>
      <Container className="flex h-16 items-center justify-between gap-3 md:h-[72px]">
        <div className="flex items-center gap-12">
          <a href={landing} aria-label={t("home")} className="flex shrink-0 items-center gap-2.5 rounded-md text-heading">
            <LogoMark className="size-6 text-fg" />
            <span className="font-mono text-[16px] font-semibold tracking-[0.16em]">EXEGEZIS</span>
          </a>
          <nav aria-label={t("main")} className="hidden items-center gap-8 text-[15px] lg:flex">
            {SECTIONS.map(([key, id]) => (
              <a key={key} href={`${landing}#${id}`} className="text-text-soft hover:text-heading">
                {t(key)}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LanguageSwitcher locale={locale} page={page} />
          <HeaderActions locale={locale} links={links} />
          <details className="relative lg:hidden">
            <summary aria-label={t("menu")} className="grid size-10 cursor-pointer place-items-center rounded-md text-heading hover:bg-hover">
              <Menu className="size-5" aria-hidden />
            </summary>
            <nav aria-label={t("main")} className="panel-frame absolute right-0 mt-2 flex w-60 flex-col gap-1 rounded-xl bg-panel p-2">
              {SECTIONS.map(([key, id]) => (
                <a key={key} href={`${landing}#${id}`} className="rounded-md px-3 py-2 text-[15px] text-heading hover:bg-hover">
                  {t(key)}
                </a>
              ))}
              <HeaderActions locale={locale} links={links} menu />
            </nav>
          </details>
        </div>
      </Container>
    </header>
  );
}
