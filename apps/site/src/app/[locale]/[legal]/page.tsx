import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LEGAL, LEGAL_SLUGS, LEGAL_VERSION, type LegalDocument } from "@content/legal";
import { PRIVACY_EMAIL } from "@content/links";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Container } from "@/components/ui";
import { isLocale, type Locale } from "@/i18n/locales";

/*
 * /es/privacidad/, /es/terminos/, /en/privacy/, /en/terms/: DRAFTS pending
 * legal review, marked as such at the top. Sign-up accepts these versions.
 */

const DOCUMENTS: LegalDocument[] = ["privacy", "terms"];

function documentFor(locale: Locale, slug: string): LegalDocument | undefined {
  return DOCUMENTS.find((d) => LEGAL_SLUGS[d][locale] === slug);
}

export function generateStaticParams({ params }: { params: { locale: string } }) {
  const locale: Locale = isLocale(params.locale) ? params.locale : "en";
  return DOCUMENTS.map((d) => ({ legal: LEGAL_SLUGS[d][locale] }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ locale: string; legal: string }> }): Promise<Metadata> {
  const { locale, legal } = await params;
  if (!isLocale(locale)) return {};
  const doc = documentFor(locale, legal);
  if (doc === undefined) return {};
  const t = await getTranslations({ locale, namespace: "legal" });
  return {
    title: `${LEGAL[doc][locale].title} · EXEGEZIS`,
    description: `${t("draft")}. ${LEGAL[doc][locale].summary}`,
    robots: { index: false },
    alternates: { languages: { en: `/en/${LEGAL_SLUGS[doc].en}/`, es: `/es/${LEGAL_SLUGS[doc].es}/` } },
  };
}

export default async function LegalPage({ params }: { params: Promise<{ locale: string; legal: string }> }) {
  const { locale, legal } = await params;
  if (!isLocale(locale)) notFound();
  const doc = documentFor(locale, legal);
  if (doc === undefined) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "legal" });
  const text = LEGAL[doc][locale];
  const other = doc === "privacy" ? "terms" : "privacy";
  const fill = (p: string) => p.replaceAll("{email}", PRIVACY_EMAIL);
  return (
    <>
      <SiteHeader locale={locale} />
      <main id="content" tabIndex={-1} className="outline-none">
        <Container className="max-w-[880px] py-12 md:py-20">
          <a href={`/${locale}/`} className="text-[14px] font-medium text-accent-text hover:underline">
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
          <p className="mt-6 text-[14px] text-muted">{t("contact", { email: PRIVACY_EMAIL })}</p>
          <p className="mt-2 text-[14px] text-muted">
            {t("other")}:{" "}
            <a href={`/${locale}/${LEGAL_SLUGS[other][locale]}/`} className="font-medium text-accent-text hover:underline">
              {LEGAL[other][locale].title}
            </a>
          </p>
        </Container>
      </main>
      <SiteFooter />
    </>
  );
}
