import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { Comparison } from "@/components/comparison";
import { FinalCta } from "@/components/final-cta";
import { Faq } from "@/components/faq";
import { Features } from "@/components/features";
import { Guarantees } from "@/components/guarantees";
import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { Platforms } from "@/components/platforms";
import { Pricing } from "@/components/pricing";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { Locale } from "@/i18n/locales";

/** The landing page, in the order of the brief: header, hero, guarantees, product, how, difference, platforms, pricing, FAQ, closing call, footer. */
export default function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale as Locale);
  return (
    <>
      <SiteHeader locale={locale as Locale} />
      <main id="content" tabIndex={-1} className="outline-none">
        <Hero />
        <Guarantees />
        <Features />
        <HowItWorks />
        <Comparison />
        <Platforms />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
