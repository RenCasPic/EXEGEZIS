import { FileQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ButtonLink, EmptyState } from "@/components/ui/primitives";

export default async function NotFound() {
  const t = await getTranslations("shell.notFound");
  return (
    <EmptyState icon={<FileQuestion />} title={t("title")} action={<ButtonLink href="/investigations">{t("action")}</ButtonLink>}>
      {t("body")}
    </EmptyState>
  );
}
