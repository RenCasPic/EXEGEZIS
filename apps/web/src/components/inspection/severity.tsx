import type { Severity } from "@exegezis/core";
import { ChevronDown, ChevronsUp, ChevronUp, Equal, Info } from "lucide-react";
import { useTranslations } from "next-intl";

const ICON = { critical: ChevronsUp, serious: ChevronUp, moderate: Equal, minor: ChevronDown, info: Info } as const;

/**
 * Severity is not a verdict: it is shown as a label with a shape icon, never
 * as a coloured pill (verdict colours mean proven / unknown / wrong).
 */
export function SeverityLabel({ severity }: { severity: Severity }) {
  const t = useTranslations("labels.severity");
  const Icon = ICON[severity];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-fg">
      <Icon className="size-3.5 text-muted" aria-hidden />
      {t(severity)}
    </span>
  );
}
