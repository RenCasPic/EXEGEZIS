import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getUiLocale } from "@/i18n/server";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell");
  return { title: { default: "EXEGEZIS", template: "%s · EXEGEZIS" }, description: t("meta.description") };
}

// Every page reads the run directories on disk at request time.
export const dynamic = "force-dynamic";

/** The document. The home (app/page.tsx) has its own header; every other page is in (app)/, inside the AppShell. */
export default async function RootLayout({ children }: { children: ReactNode }) {
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
