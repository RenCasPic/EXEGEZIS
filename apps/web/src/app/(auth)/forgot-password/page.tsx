import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { AuthCard, ForgotForm } from "@/components/auth/forms";
import { param } from "@/lib/params";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.forgot"))("title") };
}

/** Password recovery: the same answer whether or not the email has an account. */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const t = await getTranslations("account.forgot");
  const sent = param(params, "sent") === "1";
  const email = param(params, "email").slice(0, 320);
  return (
    <AuthCard
      title={t("title")}
      subtitle={sent ? t.rich("sent", { email: () => <strong className="font-semibold text-fg">{email}</strong> }) : t("subtitle")}
      footer={
        <Link href="/login" className="font-medium text-accent-text hover:underline">
          {t("backToLogin")}
        </Link>
      }
    >
      {!sent && <ForgotForm email={email} />}
    </AuthCard>
  );
}
