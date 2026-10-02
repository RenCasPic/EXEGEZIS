import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { isLocale, LOCALES } from "@/i18n/locales";
import "../globals.css";

/** Where the site is published (for absolute Open Graph URLs). */
const SITE_URL = (process.env["NEXT_PUBLIC_EXEGEZIS_SITE_URL"] ?? "http://127.0.0.1:4200").replace(/\/+$/, "");

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(SITE_URL),
    title: t("title"),
    description: t("description"),
    alternates: { canonical: `/${locale}/`, languages: { en: "/en/", es: "/es/", "x-default": "/" } },
    openGraph: {
      type: "website",
      siteName: "EXEGEZIS",
      title: t("title"),
      description: t("description"),
      url: `/${locale}/`,
      locale: locale === "es" ? "es_ES" : "en_US",
      alternateLocale: locale === "es" ? ["en_US"] : ["es_ES"],
      images: [{ url: `/og-${locale}.png`, width: 1200, height: 630, alt: t("ogAlt") }],
    },
    twitter: { card: "summary_large_image", title: t("title"), description: t("description"), images: [`/og-${locale}.png`] },
  };
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={locale} data-theme="light" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
