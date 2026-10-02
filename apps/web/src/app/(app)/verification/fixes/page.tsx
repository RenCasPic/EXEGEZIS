import { GitPullRequestDraft } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotImplementedPage } from "@/components/investigation/not-implemented-page";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("fixes"))("title") };
}

export default async function FixesPage() {
  const t = await getTranslations("fixes");
  return <NotImplementedPage title={t("title")} description={t("description")} icon={<GitPullRequestDraft />} why={t("why")} requires={[t("r1"), t("r2"), t("r3"), t("r4")]} />;
}
