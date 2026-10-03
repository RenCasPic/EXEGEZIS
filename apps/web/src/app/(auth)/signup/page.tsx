import { isPlanId, safeNext } from "@exegezis/accounts";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { AuthCard, OAuthButtons, SignUpForm } from "@/components/auth/forms";
import { cloud } from "@/lib/cloud";
import { siteLinks } from "@/lib/links";
import { param } from "@/lib/params";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.signup"))("title") };
}

/**
 * /signup?plan=pro&next=/?url=… — from the landing. A paid plan cannot be
 * bought yet: the account starts on Free and joins that plan's waiting list.
 */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const [t, plans, locale] = await Promise.all([getTranslations("account.signup"), getTranslations("account.plans"), getLocale()]);
  const next = safeNext(param(params, "next"));
  const raw = param(params, "plan");
  const plan = isPlanId(raw) ? raw : "free";
  const links = siteLinks(locale === "es" ? "es" : "en");
  const login = `/login${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`;
  return (
    <AuthCard
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        <>
          {t("haveAccount")}{" "}
          <Link href={login} className="font-medium text-accent-text hover:underline">
            {t("signIn")}
          </Link>
        </>
      }
    >
      {plan !== "free" && (
        <p role="status" className="rounded-xl border border-dashed border-line-strong bg-sunken px-3.5 py-2.5 text-[14px] text-fg">
          {t("paidPlan", { plan: plans(plan) })}
        </p>
      )}
      <OAuthButtons providers={cloud().oauthProviders} next={next} />
      <SignUpForm next={next} plan={plan} termsUrl={links.terms} privacyUrl={links.privacy} />
    </AuthCard>
  );
}
