import { FileQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/app-shell/shell";
import { ButtonLink, EmptyState } from "@/components/ui/primitives";

export default async function NotFound() {
  const t = await getTranslations("shell.notFound");
  return (
    <AppShell>
      <EmptyState icon={<FileQuestion />} title={t("title")} action={<ButtonLink href="/investigations">{t("action")}</ButtonLink>}>
        {t("body")}
      </EmptyState>
    </AppShell>
  );
}
