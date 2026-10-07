import { INSPECTABLE, type Finding, type InspectionReport, type IssueGroup } from "@exegezis/core";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { DeviceScope } from "@/components/inspection/device-scope";
import { SeverityLabel } from "@/components/inspection/severity";
import { VerdictPill } from "@/components/ui/status";
import { shortUrl } from "@/lib/inspection-labels";
import { groupTitle } from "@/lib/issue-labels";
import { artifactUrl } from "@/lib/urls";

/** A sample of text in the page's own colours (data from the report, not design tokens). */
function Swatch({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-8 w-12 place-items-center rounded border border-line-strong text-[15px] font-semibold" style={{ color: fg, background: bg }} aria-hidden translate="no">
        Aa
      </span>
      <span className="text-[12px] text-muted">{label}</span>
    </span>
  );
}

function selectorOf(f: Finding): string | null {
  // A small touch target: its detail starts with "<selector> is <w>×<h> px".
  if (f.checkId === "mobile-tap-targets") return /^([\s\S]*?) is \d/.exec(f.detail)?.[1] ?? null;
  const i = f.title.indexOf("): ");
  return f.checkId === "a11y" && i >= 0 ? f.title.slice(i + 3) : null;
}

function Example({ inspectionId, finding, origin }: { inspectionId: string; finding: Finding; origin: string }) {
  const t = useTranslations("inspections.group");
  const shot = finding.evidence.find((e) => e.kind === "screenshot" && e.path.endsWith("axe-highlight.png")) ?? finding.evidence.find((e) => e.kind === "screenshot");
  const selector = selectorOf(finding);
  const page = shortUrl(finding.page, origin);
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-mono text-faint">{finding.id}</span>
        <span className="font-mono text-muted">{page}</span>
        {finding.verdict !== "VERIFIED" && <VerdictPill verdict={finding.verdict} size="xs" />}
        <Link href={`?vista=elementos&q=${encodeURIComponent(finding.id)}`} className="ml-auto text-accent-text hover:underline">
          {t("viewElement")}
        </Link>
      </div>
      {selector !== null && <code className="font-mono text-[11px] break-all text-fg">{selector}</code>}
      {shot !== undefined && (
        <img
          src={artifactUrl(inspectionId, shot.path)}
          alt={shot.path.endsWith("axe-highlight.png") ? t("shotAltMarked", { page }) : t("shotAlt", { page })}
          className="max-h-72 w-full rounded border border-line bg-white object-contain object-top"
          loading="lazy"
        />
      )}
    </li>
  );
}

export function IssueGroupItem({ inspectionId, group, report }: { inspectionId: string; group: IssueGroup; report: InspectionReport }) {
  const ti = useTranslations("inspections");
  const t = useTranslations("inspections.group");
  const locale = useLocale();
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  const examples = group.examples.map((id) => byId.get(id)).filter((f): f is Finding => f !== undefined);
  const specs = group.findings.filter((id) => byId.get(id)?.spec !== null).length;
  const c = group.contrast;
  const tap = group.tapTarget;
  // On every inspected page: most likely a shared template, fixed in one place.
  const inspected = new Set(report.pages.filter((p) => INSPECTABLE.includes(p.status)).map((p) => p.url)).size;
  const global = inspected > 1 && group.pages.length >= inspected;
  return (
    <li className="border-b border-line last:border-b-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-hover/40 [&::-webkit-details-marker]:hidden">
          <VerdictPill verdict={group.verdict} size="xs" title={ti(`groupVerdict.${group.verdict}`)} />
          <SeverityLabel severity={group.severity} />
          {c !== null && (
            <span className="grid h-6 w-9 shrink-0 place-items-center rounded border border-line-strong text-[12px] font-semibold" style={{ color: c.foreground, background: c.background }} aria-hidden translate="no">
              Aa
            </span>
          )}
          <span className="min-w-0 flex-1 basis-64 text-[13px] font-medium break-words text-fg">{groupTitle(ti, locale, group)}</span>
          {global && (
            <span title={t("globalHelp")} className="rounded border border-line-strong px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-fg">
              {t("global")}
            </span>
          )}
          <DeviceScope findings={report.findings.filter((f) => group.findings.includes(f.id))} inspected={report.options.devices} />
          <span className="font-mono text-[12px] whitespace-nowrap text-muted">
            {t("counts", { elements: group.elements, pages: group.pages.length })}
            {group.intermittent > 0 && group.verified > 0 ? ` · ${t("intermittentCount", { count: group.intermittent })}` : ""}
          </span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line bg-panel-2 px-4 py-4">
          {group.verdict === "MIXED" && <p className="text-[13px] text-fg">{t("mixed", { verified: group.verified, elements: group.elements, intermittent: group.intermittent })}</p>}
          {global && <p className="text-[13px] text-fg">{t("globalHelp")}</p>}
          {tap !== null && <p className="text-[13px] text-fg">{t("tapSuggestion", { x: tap.padding.x, y: tap.padding.y })}</p>}
          {c !== null && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Swatch
                  fg={c.foreground}
                  bg={c.background}
                  label={t("current", { fg: c.foreground.toUpperCase(), bg: c.background.toUpperCase(), ratio: number.format(c.ratio), required: number.format(c.required), large: c.textSize === "large" ? "yes" : "no" })}
                />
                {c.suggestion !== null && <Swatch fg={c.suggestion.color} bg={c.background} label={t("suggestion", { color: c.suggestion.color.toUpperCase(), ratio: number.format(c.suggestion.ratio) })} />}
              </div>
              {c.suggestion !== null && <p className="text-[12px] text-muted">{t("suggestionHelp")}</p>}
            </div>
          )}
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted">{t("pages", { count: group.pages.length })}</h4>
            <ul className="flex flex-wrap gap-1.5">
              {group.pages.map((p) => (
                <li key={p} className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[12px] text-fg">
                  {shortUrl(p, report.target.origin)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-medium text-muted">
              {t("examples", { shown: examples.length, total: group.elements })} · {specs === 0 ? t("noSpec") : t("specs", { count: specs })}
            </h4>
            <ul className="grid gap-3 lg:grid-cols-2">
              {examples.map((f) => (
                <Example key={f.id} inspectionId={inspectionId} finding={f} origin={report.target.origin} />
              ))}
            </ul>
          </div>
          <p className="font-mono text-[11px] text-faint">{group.id}</p>
        </div>
      </details>
    </li>
  );
}

export function IssueGroupList({ inspectionId, groups, report, empty }: { inspectionId: string; groups: IssueGroup[]; report: InspectionReport; empty: string }) {
  if (groups.length === 0) return <p className="px-4 py-6 text-[13px] text-muted">{empty}</p>;
  return (
    <ul>
      {groups.map((g) => (
        <IssueGroupItem key={g.id} inspectionId={inspectionId} group={g} report={report} />
      ))}
    </ul>
  );
}
