import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { NotImplemented } from "@/components/ui/status";

/** A section the product will have, shown honestly as absent: zero records, no placeholders. */
export function NotImplementedPage({ title, description, icon, why, requires }: { title: string; description: string; icon: ReactNode; why: string; requires: string[] }) {
  const t = useTranslations("investigations.notImplemented");
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} description={description} eyebrow={<NotImplemented />} />
      <Panel title={t("records")}>
        <EmptyState icon={icon} title={t("notYet")}>
          {why}
        </EmptyState>
        <div className="mx-auto max-w-xl border-t border-line pt-4">
          <div className="mb-2 text-[11px] font-medium text-faint">{t("requires")}</div>
          <ul className="flex flex-col gap-1.5 text-[13px] text-muted">
            {requires.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="text-faint">—</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </div>
  );
}
