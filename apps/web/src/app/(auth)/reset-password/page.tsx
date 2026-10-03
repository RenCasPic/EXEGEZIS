import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthCard, ResetForm } from "@/components/auth/forms";
import { cloudOnly, requireUser } from "@/lib/cloud";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("account.reset"))("title") };
}

/** Reached from the recovery email (its link signs the person in): choose a new password. */
export default async function ResetPasswordPage() {
  cloudOnly();
  const user = await requireUser();
  const t = await getTranslations("account.reset");
  return (
    <AuthCard title={t("title")} subtitle={t.rich("subtitle", { email: () => <strong className="font-semibold text-fg">{user.email}</strong> })}>
      <ResetForm />
    </AuthCard>
  );
}
