import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/app-shell/language-switcher";
import { ThemeSwitcher } from "@/components/app-shell/theme-switcher";
import { HomeLogo } from "@/components/home/home-header";
import { AppDocument, appMetadata } from "@/components/app-shell/document";
import { getUiLocale } from "@/i18n/server";
import { isCloud } from "@/lib/cloud";
import { siteLinks } from "@/lib/links";

export const generateMetadata = appMetadata;

export const dynamic = "force-dynamic";

/** The account screens (cloud mode only): the logo, the language and the theme, and one card in the middle. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (!isCloud()) notFound();
  const links = siteLinks(await getUiLocale());
  return (
    <AppDocument>
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex h-14 items-center justify-between border-b border-line pr-2 pl-4 sm:h-16 sm:px-8">
        <a href={links.landing} className="flex items-center gap-2 text-heading">
          <HomeLogo className="size-5 text-fg sm:size-[22px]" />
          <span className="font-mono text-[14px] font-semibold tracking-[0.14em] sm:text-[15px]">EXEGEZIS</span>
        </a>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main id="content" className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        {children}
      </main>
    </div>
    </AppDocument>
  );
}
