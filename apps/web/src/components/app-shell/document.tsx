import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getUiLocale } from "@/i18n/server";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "@/app/globals.css";

/*
 * The app's document (the root of (home), (app) and (auth)): the language from
 * the cookie, the theme set before paint, every catalog for the client. The
 * public pages (src/site) have their own, static one.
 */

export async function appMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell");
  return { title: { default: "EXEGEZIS", template: "%s · EXEGEZIS" }, description: t("meta.description") };
}

export async function AppDocument({ children }: { children: ReactNode }) {
  const locale = await getUiLocale();
  return (
    // data-theme is set by the boot script before React hydrates.
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
