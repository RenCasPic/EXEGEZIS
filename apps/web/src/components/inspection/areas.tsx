import { INSPECTABLE, medianRange, organizeGroups, rate, type Area, type AreaSummary, type InspectionReport, type IssueGroup, type Subarea } from "@exegezis/core";
import { MonitorSmartphone, Server } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { IssueGroupList } from "@/components/inspection/issue-groups";
import { SeverityLabel } from "@/components/inspection/severity";
import { tableClass } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { shortUrl } from "@/lib/inspection-labels";

/*
 * The inspection organized: Frontend (what the page does in the browser) and
 * Backend (the server, seen from outside), each split into subareas, each
 * with its issue groups. The map is core's (issue-areas.ts), applied when the
 * report is shown, so older reports are organized the same way.
 */

const ICON: Record<Area, typeof Server> = { frontend: MonitorSmartphone, backend: Server };

export const anchorOf = (area: Area, subarea: Subarea) => `area-${area}-${subarea}`;

/** The two cards at the top: problems and the worst severity of each area, and its subareas. */
export function AreaCards({ report }: { report: InspectionReport }) {
  const t = useTranslations("inspections.areas");
  const areas = organizeGroups(report.groups, report.findings);
  return (
    <section aria-label={t("label")} className="grid gap-3 md:grid-cols-2">
      {areas.map((a) => (
        <AreaCard key={a.area} summary={a} accessNotes={a.area === "backend" ? accessCount(report) : 0} />
      ))}
    </section>
  );
}

function AreaCard({ summary, accessNotes }: { summary: AreaSummary; accessNotes: number }) {
  const t = useTranslations("inspections.areas");
  const Icon = ICON[summary.area];
  return (
    <div className="panel-frame flex min-w-0 flex-col gap-3 rounded-lg bg-panel px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Icon className="size-4 text-muted" aria-hidden />
        <h2 className="text-[14px] font-semibold text-fg">{t(`area.${summary.area}`)}</h2>
        <span className="text-[12px] text-muted">{t(`areaHint.${summary.area}`)}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-mono text-[26px] leading-tight font-semibold text-fg">{summary.problems}</span>
        <span className="text-[13px] text-muted">{t("problems", { count: summary.problems })}</span>
        {summary.worst !== null && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
            {t("worst")} <SeverityLabel severity={summary.worst} />
          </span>
        )}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {summary.subareas.map((s) => {
          const count = s.subarea === "access" ? accessNotes : s.problems;
          return (
            <li key={s.subarea}>
              <a
                href={`#${anchorOf(summary.area, s.subarea)}`}
                className={cn("inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[12px] hover:bg-hover", count > 0 ? "border-line-strong text-fg" : "border-line text-muted")}
              >
                {t(`subarea.${s.subarea}`)}
                <span className="font-mono">{count}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Visits that did not get through, pages left out by robots.txt or for safety, rate limits: the «Access» subarea. */
function accessCount(report: InspectionReport): number {
  const blocked = new Set(report.pages.filter((p) => p.status === "BLOCKED").map((p) => p.url)).size;
  return blocked + report.skippedForSafety.length + (report.rateLimit.retries > 0 ? 1 : 0);
}

function AccessNotes({ report }: { report: InspectionReport }) {
  const t = useTranslations("inspections.areas.access");
  const blocked = [...new Set(report.pages.filter((p) => p.status === "BLOCKED").map((p) => p.url))];
  const robots = new Set(report.pages.filter((p) => p.status === "SKIPPED_ROBOTS").map((p) => p.url)).size;
  const lines = [
    blocked.length > 0 && t("blocked", { count: blocked.length }),
    robots > 0 && t("robots", { count: robots }),
    report.skippedForSafety.length > 0 && t("unsafe", { count: report.skippedForSafety.length }),
    report.rateLimit.retries > 0 && t("rateLimit", { count: report.rateLimit.retries, seconds: Math.round(report.rateLimit.waitedSeconds) }),
    report.access.session && t("session"),
  ].filter((x): x is string => typeof x === "string");
  return (
    <ul className="flex flex-col gap-1 px-4 py-3 text-[13px] text-fg">
      {lines.length === 0 ? <li className="text-muted">{t("none")}</li> : lines.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}

/** The problems, by area and subarea (only the subareas that have some, plus Access). */
export function AreaGroupList({ inspectionId, groups, report, empty }: { inspectionId: string; groups: IssueGroup[]; report: InspectionReport; empty: string }) {
  const t = useTranslations("inspections.areas");
  const areas = organizeGroups(groups, report.findings);
  if (groups.length === 0) return <p className="px-4 py-6 text-[13px] text-muted">{empty}</p>;
  return (
    <div className="flex flex-col">
      {areas.map((a) => {
        const subareas = a.subareas.filter((s) => s.groups.length > 0 || (s.subarea === "access" && accessCount(report) > 0));
        if (subareas.length === 0) return null;
        return (
          <section key={a.area} aria-labelledby={`area-${a.area}`} className="border-b border-line last:border-b-0">
            <h3 id={`area-${a.area}`} className="bg-panel-2 px-4 py-2 text-[12px] font-semibold tracking-wide text-muted uppercase">
              {t(`area.${a.area}`)}
            </h3>
            {subareas.map((s) => (
              <section key={s.subarea} id={anchorOf(a.area, s.subarea)} aria-labelledby={`${anchorOf(a.area, s.subarea)}-title`} className="scroll-mt-20 border-t border-line">
                <h4 id={`${anchorOf(a.area, s.subarea)}-title`} className="flex flex-wrap items-center gap-x-2 px-4 pt-3 pb-1 text-[13px] font-semibold text-fg">
                  {t(`subarea.${s.subarea}`)}
                  <span className="font-mono text-[12px] font-normal text-muted">{s.subarea === "access" ? accessCount(report) : s.groups.length}</span>
                </h4>
                {s.subarea === "access" ? <AccessNotes report={report} /> : <IssueGroupList inspectionId={inspectionId} groups={s.groups} report={report} empty="" />}
              </section>
            ))}
          </section>
        );
      })}
    </div>
  );
}

type MetricKey = "lcpMs" | "cls" | "tbtMs" | "ttfbMs" | "fcpMs" | "loadMs" | "bytes" | "requests";
const RATED = new Set<MetricKey>(["lcpMs", "cls", "tbtMs", "ttfbMs", "fcpMs"]);
const RATING_CLASS = { good: "text-ok", "needs-improvement": "text-warn", poor: "text-bad" } as const;

/** Lab metrics per page and device: the median of the runs, with their range. */
export function PerformanceTable({ report }: { report: InspectionReport }) {
  const t = useTranslations("inspections.performance");
  const locale = useLocale();
  const rows = new Map<string, InspectionReport["pages"]>();
  for (const p of report.pages) {
    if (!INSPECTABLE.includes(p.status) || p.metrics === null) continue;
    const key = `${p.url}\u0000${p.device}`;
    rows.set(key, [...(rows.get(key) ?? []), p]);
  }
  if (rows.size === 0) return <p className="px-4 py-4 text-[13px] text-muted">{t("none")}</p>;
  const n1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const n2 = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const format = (k: MetricKey, v: number) =>
    k === "cls" ? n2.format(v) : k === "bytes" ? `${n1.format(v / 1024 / 1024)} MB` : k === "requests" ? String(Math.round(v)) : v >= 1000 ? `${n1.format(v / 1000)} s` : `${Math.round(v)} ms`;
  const COLS: MetricKey[] = ["lcpMs", "cls", "tbtMs", "ttfbMs", "fcpMs", "loadMs", "bytes", "requests"];
  return (
    <div className={tableClass.wrap}>
      <table className={tableClass.table}>
        <thead>
          <tr>
            <th className={tableClass.th}>{t("page")}</th>
            <th className={tableClass.th}>{t("device")}</th>
            {COLS.map((c) => (
              <th key={c} className={tableClass.th} title={t(`help.${c}`)}>
                {t(`col.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...rows.values()].map((visits) => {
            const first = visits[0] as InspectionReport["pages"][number];
            return (
              <tr key={`${first.url} ${first.device}`} className={tableClass.tr}>
                <td className={`${tableClass.td} max-w-56 break-all font-mono text-[12px]`}>{shortUrl(first.url, report.target.origin)}</td>
                <td className={`${tableClass.td} whitespace-nowrap text-[12px]`}>{t(`deviceName.${first.device}`)}</td>
                {COLS.map((c) => {
                  const m = medianRange(visits.map((v) => (v.metrics === null ? null : v.metrics[c])));
                  if (m === null) return <td key={c} className={`${tableClass.td} text-faint`}>—</td>;
                  const rating = RATED.has(c) ? rate(c as "lcpMs", m.median) : null;
                  return (
                    <td key={c} className={`${tableClass.td} relative whitespace-nowrap`}>
                      <span className={cn("font-mono text-[12px] font-semibold", rating === null ? "text-fg" : RATING_CLASS[rating])}>
                        {format(c, m.median)}
                        {rating !== null && <span className="sr-only"> ({t(`rating.${rating}`)})</span>}
                      </span>
                      {m.n > 1 && m.min !== m.max && (
                        <span className="block font-mono text-[10px] text-faint">
                          {format(c, m.min)}–{format(c, m.max)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

