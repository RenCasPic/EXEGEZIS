import { safeNext } from "@exegezis/accounts";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { AuthCard, WelcomeForm } from "@/components/auth/forms";
import { requireUser } from "@/lib/cloud";
import { siteLinks } from "@/lib/links";
import { param } from "@/lib/params";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.welcome"))("titlePlain") };
}

/** A sign-up with Google or GitHub skipped the form: accept the terms and the privacy policy before entering. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, params, t, locale] = await Promise.all([requireUser(), searchParams, getTranslations("account.welcome"), getLocale()]);
  const links = siteLinks(locale === "es" ? "es" : "en");
  return (
    <AuthCard title={user.name === "" ? t("titlePlain") : t("title", { name: user.name })} subtitle={t("subtitle")}>
      <WelcomeForm next={safeNext(param(params, "next"))} termsUrl={links.terms} privacyUrl={links.privacy} />
    </AuthCard>
  );
}
