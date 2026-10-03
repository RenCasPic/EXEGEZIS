import { safeNext } from "@exegezis/accounts";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AuthCard, ResendForm } from "@/components/auth/forms";
import { param } from "@/lib/params";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.verify"))("title") };
}

/** After signing up: the account works once the link in the email is opened. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const t = await getTranslations("account.verify");
  const email = param(params, "email").slice(0, 320);
  const next = safeNext(param(params, "next"));
  return (
    <AuthCard
      title={t("title")}
      subtitle={email === "" ? t("bodyNoEmail") : t.rich("body", { email: () => <strong className="font-semibold text-fg">{email}</strong> })}
      footer={
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-accent-text hover:underline">
          {t("backToLogin")}
        </Link>
      }
    >
      <p className="text-[14px] text-muted">{t("spam")}</p>
      {email !== "" && <ResendForm email={email} next={next} />}
    </AuthCard>
  );
}
