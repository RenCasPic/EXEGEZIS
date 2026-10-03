import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Comparison } from "./components/comparison";
import { Faq } from "./components/faq";
import { Features } from "./components/features";
import { FinalCta } from "./components/final-cta";
import { Guarantees } from "./components/guarantees";
import { Hero } from "./components/hero";
import { HowItWorks } from "./components/how-it-works";
import { Platforms } from "./components/platforms";
import { Pricing } from "./components/pricing";
import { SiteFooter } from "./components/site-footer";
import { SiteHeader } from "./components/site-header";
import { Container } from "./components/ui";
import { otherLocale, SITE_PATHS, siteT, type SiteLocale, type SitePage } from "./i18n";
import { LEGAL, LEGAL_VERSION, type LegalDocument } from "./legal";
import { privacyEmail, siteLinks } from "./links";
import "./site.css";

/*
 * The public pages (landing, privacy, terms): static, in the language of their
 * path. Rendered once at build time (or cached): no cookie, no session, no
 * data of the app. The app's own pages are elsewhere (src/app/(home), (app),
 * (auth)).
 */

/** Where the site is published (absolute Open Graph URLs): the app's address in cloud mode. */
function publicUrl(): string {
  return ((process.env["EXEGEZIS_APP_URL"] ?? "").trim() || "http://127.0.0.1:4100").replace(/\/+$/, "");
}

/** The document of the public pages (one root layout per language). */
export function SiteDocument({ locale, children }: { locale: SiteLocale; children: ReactNode }) {
  return (
    <html lang={locale} data-theme="light" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}

export function siteMetadata(locale: SiteLocale, page: SitePage): Metadata {
  const t = siteT(locale, "meta");
  const legal = page === "landing" ? null : LEGAL[page][locale];
  const title = legal === null ? t("title") : `${legal.title} · EXEGEZIS`;
  const description = legal === null ? t("description") : `${siteT(locale, "legal")("draft")}. ${legal.summary}`;
  const other = otherLocale(locale);
  return {
    metadataBase: new URL(publicUrl()),
    title: { absolute: title },
    description,
    alternates: { canonical: SITE_PATHS[page][locale], languages: { [locale]: SITE_PATHS[page][locale], [other]: SITE_PATHS[page][other] } },
    ...(legal === null ? {} : { robots: { index: false } }),
    openGraph: {
      type: "website",
      siteName: "EXEGEZIS",
      title,
      description,
      url: SITE_PATHS[page][locale],
      locale: locale === "es" ? "es_ES" : "en_US",
      alternateLocale: locale === "es" ? ["en_US"] : ["es_ES"],
      images: [{ url: `/og-${locale}.png`, width: 1200, height: 630, alt: t("ogAlt") }],
    },
    twitter: { card: "summary_large_image", title, description, images: [`/og-${locale}.png`] },
  };
}

/** The landing, in the order of docs/design/landing.html. */
export function LandingPage({ locale }: { locale: SiteLocale }) {
  const links = siteLinks(locale);
  return (
    <>
      <SiteHeader locale={locale} page="landing" links={links} />
      <main id="content" tabIndex={-1} className="outline-none">
        <Hero locale={locale} cloud={links.cloud} />
        <Guarantees locale={locale} />
        <Features locale={locale} />
        <HowItWorks locale={locale} />
        <Comparison locale={locale} />
        <Platforms locale={locale} />
        <Pricing locale={locale} links={links} />
        <Faq locale={locale} />
        <FinalCta locale={locale} />
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}

/** /privacidad, /terminos, /privacy, /terms: DRAFTS pending legal review, marked as such at the top. */
export function LegalPage({ locale, doc }: { locale: SiteLocale; doc: LegalDocument }) {
  const t = siteT(locale, "legal");
  const text = LEGAL[doc][locale];
  const other: LegalDocument = doc === "privacy" ? "terms" : "privacy";
  const email = privacyEmail();
  const fill = (p: string) => p.replaceAll("{email}", email);
  return (
    <>
      <SiteHeader locale={locale} page={doc} links={siteLinks(locale)} />
      <main id="content" tabIndex={-1} className="outline-none">
        <Container className="max-w-[880px] py-12 md:py-20">
          <a href={SITE_PATHS.landing[locale]} className="text-[14px] font-medium text-accent-text hover:underline">
            {t("back")}
          </a>
          <div role="note" className="mt-6 rounded-2xl border-[1.5px] border-dashed border-warn bg-warn-bg px-5 py-4" data-legal-draft>
            <p className="text-[15px] font-semibold text-warn">{t("draft")}</p>
            <p className="mt-1 text-[14px] text-heading">{t("draftBody")}</p>
          </div>
          <h1 className="mt-8 text-[32px] leading-[1.1] font-semibold tracking-[-0.02em] text-heading md:text-[44px]">{text.title}</h1>
          <p className="mt-3 text-[18px] leading-[1.5] text-muted">{text.summary}</p>
          <p className="mt-3 font-mono text-[13px] text-muted">{t("version", { version: LEGAL_VERSION[doc] })}</p>
          <div className="panel-frame mt-8 flex flex-col gap-8 rounded-2xl bg-panel p-6 md:p-10">
            {text.sections.map((s) => (
              <section key={s.heading} className="flex flex-col gap-3">
                <h2 className="text-[20px] font-semibold text-heading">{s.heading}</h2>
                {s.paragraphs.map((p) => (
                  <p key={p.slice(0, 40)} className="text-[16px] leading-[1.6] text-heading">
                    {fill(p)}
                  </p>
                ))}
              </section>
            ))}
          </div>
          <p className="mt-6 text-[14px] text-muted">{t("contact", { email })}</p>
          <p className="mt-2 text-[14px] text-muted">
            {t("other")}:{" "}
            <a href={SITE_PATHS[other][locale]} className="font-medium text-accent-text hover:underline">
              {LEGAL[other][locale].title}
            </a>
          </p>
        </Container>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
