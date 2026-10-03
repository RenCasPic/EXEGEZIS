import { safeNext } from "@exegezis/accounts";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AuthCard, OAuthButtons, SignInForm } from "@/components/auth/forms";
import { config } from "@/lib/auth";
import { param } from "@/lib/params";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.login"))("title") };
}

const NOTICES = ["signedOut", "signedOutEverywhere", "deleted"] as const;
const ERRORS = ["link", "oauth", "origin"] as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const t = await getTranslations("account.login");
  const next = safeNext(param(params, "next"));
  const notice = NOTICES.find((n) => n === param(params, "notice"));
  const error = ERRORS.find((e) => e === param(params, "error"));
  const signup = `/signup${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`;
  return (
    <AuthCard
      title={t("title")}
      subtitle={t("subtitle")}
      footer={
        <>
          {t("noAccount")}{" "}
          <Link href={signup} className="font-medium text-accent-text hover:underline">
            {t("createOne")}
          </Link>
        </>
      }
    >
      {notice !== undefined && (
        <p role="status" className="rounded-xl border border-ok/30 bg-ok-bg px-3.5 py-2.5 text-[14px] text-ok">
          {t(`notice.${notice}`)}
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="rounded-xl border border-bad/30 bg-bad-bg px-3.5 py-2.5 text-[14px] text-bad">
          {t(`error.${error}`)}
        </p>
      )}
      <OAuthButtons providers={config().oauthProviders} next={next} />
      <SignInForm next={next} />
    </AuthCard>
  );
}
