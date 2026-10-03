import { ChevronRight, Globe, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { ButtonLink, EmptyState, PageHeader, Panel, tableClass } from "@/components/ui/primitives";
import { groupStats } from "@exegezis/core";
import { DeleteInspection } from "@/components/inspection/delete-inspection";
import { StatusPill } from "@/components/ui/status";
import { listInspections } from "@/lib/evidence/inspections";
import { getFormat } from "@/i18n/server";
import { INSPECTION_STATUS_TONE } from "@/lib/inspection-labels";
import { listJobs } from "@/lib/jobs";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("inspections.list"))("title") };
}

export default async function InspectionsPage() {
  const [inspections, jobs, t, f] = await Promise.all([listInspections(), listJobs(), getTranslations("inspections.list"), getFormat()]);
  const pending = jobs.filter((j) => j.job.kind === "inspect" && (j.status === "running" || j.status === "queued"));

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh active={pending.length > 0} />
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <ButtonLink href="/" variant="primary">
            <Plus /> {t("new")}
          </ButtonLink>
        }
      />

      {pending.length > 0 && (
        <Panel title={t("running")} bodyClassName="p-0">
          <ul>
            {pending.map(({ job, status }) => (
              <li key={job.id} className="border-b border-line last:border-b-0">
                <Link href={`/jobs/${job.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                  <StatusPill status={status === "queued" ? "QUEUED" : "RUNNING"} tone={status === "queued" ? "q" : "running"} size="xs" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{job.kind === "inspect" ? job.url : job.id}</span>
                  <span className="text-xs text-faint">{f.relative(job.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={t("count", { count: inspections.length })} bodyClassName="p-0">
        {inspections.length === 0 ? (
          <EmptyState
            icon={<Globe />}
            title={t("none")}
            action={
              <ButtonLink href="/" variant="primary">
                <Plus /> {t("inspect")}
              </ButtonLink>
            }
          >
            {t.rich("noneBody", { command: () => <code className="font-mono">pnpm exegezis inspect --url https://…</code> })}
          </EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>{t("colSite")}</th>
                  <th className={tableClass.th}>{t("colStatus")}</th>
                  <th className={tableClass.th}>{t("colVerified")}</th>
                  <th className={tableClass.th}>{t("colIntermittent")}</th>
                  <th className={tableClass.th}>{t("colPages")}</th>
                  <th className={tableClass.th}>{t("colDate")}</th>
                  <th className={tableClass.th} aria-label={t("colSite")} />
                </tr>
              </thead>
              <tbody>
                {inspections.map((i) => {
                  const r = i.report.status === "ok" ? i.report.value : null;
                  const g = r === null ? null : groupStats(r.groups, r.findings);
                  return (
                    <tr key={i.id} className={tableClass.tr}>
                      <td className={tableClass.td}>
                        <Link href={`/inspections/${i.id}`} className="break-all font-mono text-[12px] text-fg hover:underline">
                          {r?.target.url ?? i.relDir}
                        </Link>
                        <div className="font-mono text-[11px] text-faint">{i.id}</div>
                      </td>
                      <td className={tableClass.td}>
                        {r === null ? (
                          <StatusPill status={i.report.status === "missing" ? "MISSING" : "INVALID_REPORT"} tone="bad" size="xs" />
                        ) : (
                          <StatusPill status={r.status} tone={INSPECTION_STATUS_TONE[r.status]} size="xs" />
                        )}
                      </td>
                      <td className={`${tableClass.td} whitespace-nowrap font-mono text-[12px]`}>{g === null ? "—" : t("problems", { problems: g.problems, elements: g.elements })}</td>
                      <td className={`${tableClass.td} whitespace-nowrap font-mono text-[12px]`}>{g === null ? "—" : t("intermittent", { problems: g.intermittentProblems, elements: g.intermittentElements })}</td>
                      <td className={`${tableClass.td} font-mono`}>{r?.summary.pagesVisited ?? "—"}</td>
                      <td className={`${tableClass.td} whitespace-nowrap text-xs text-muted`}>{r === null ? "—" : f.relative(r.finishedAt)}</td>
                      <td className={tableClass.td}>
                        <div className="flex items-center justify-end gap-1">
                          <DeleteInspection id={i.id} from="list" />
                          <Link href={`/inspections/${i.id}`} aria-label={t("open", { id: i.id })} className="text-faint hover:text-fg">
                            <ChevronRight className="size-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
