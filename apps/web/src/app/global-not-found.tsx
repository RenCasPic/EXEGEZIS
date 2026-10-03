import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import { cookies, headers } from "next/headers";
import { resolveLocale, LOCALE_COOKIE } from "@/i18n/locales";
import { loadMessages } from "@/i18n/messages";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = { title: "404 · EXEGEZIS" };

/**
 * A URL that matches no page. The app and the public pages have separate root
 * layouts, so this one stands alone: the reader's language (cookie, else the
 * browser's) and theme, and the way back.
 */
export default async function GlobalNotFound() {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(jar.get(LOCALE_COOKIE)?.value, head.get("accept-language"));
  const t = createTranslator({ locale, messages: { shell: loadMessages(locale).shell }, namespace: "shell.notFound" });
  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="grid min-h-screen place-items-center bg-bg font-sans text-fg antialiased">
        <main className="flex max-w-md flex-col items-center gap-3 p-8 text-center">
          <p className="font-mono text-[13px] tracking-[0.14em] text-accent-text">404</p>
          <h1 className="text-[24px] font-semibold text-heading">{t("title")}</h1>
          <p className="text-[14px] text-muted">{t("body")}</p>
          <a href="/" className="mt-2 rounded-lg bg-accent px-4 py-2 text-[14px] font-semibold text-on-accent hover:bg-accent-hover">
            EXEGEZIS
          </a>
        </main>
      </body>
    </html>
  );
}
