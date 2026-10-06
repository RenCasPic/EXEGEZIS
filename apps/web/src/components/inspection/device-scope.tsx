import { deviceScope, type Device, type Finding } from "@exegezis/core";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useTranslations } from "next-intl";

const ICON = { desktop: Monitor, mobile: Smartphone, tablet: Tablet } as const;

/**
 * Where a finding (or a group of findings) is verified: «Only on mobile»,
 * «Only on desktop», «On both» (or «On every device» with three). Nothing
 * when the inspection used one device, or nothing is verified.
 */
export function DeviceScope({ findings, inspected }: { findings: readonly Pick<Finding, "devices" | "verdict">[]; inspected: readonly Device[] }) {
  const t = useTranslations("inspections.devices");
  const tc = useTranslations("common");
  const scope = deviceScope(findings, inspected);
  if (scope === null) return null;
  const devices = scope === "all" ? [...inspected] : scope;
  const label = scope === "all" ? (inspected.length === 2 ? t("both") : t("all")) : t("only", { list: scope.map((d) => tc(`device.${d}`).toLowerCase()).join(", ") });
  return (
    <span className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] whitespace-nowrap text-muted" title={label}>
      {devices.map((d) => {
        const Icon = ICON[d];
        return <Icon key={d} className="size-3" aria-hidden />;
      })}
      {label}
    </span>
  );
}
