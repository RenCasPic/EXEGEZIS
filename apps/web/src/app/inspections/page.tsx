import { ChevronRight, Globe, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { ButtonLink, EmptyState, PageHeader, Panel, tableClass } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { listInspections } from "@/lib/evidence/inspections";
import { relativeTime } from "@/lib/format";
import { INSPECTION_STATUS_TONE } from "@/lib/inspection-labels";
import { listJobs } from "@/lib/jobs";

export const metadata: Metadata = { title: "Inspecciones" };

export default async function InspectionsPage() {
  const [inspections, jobs] = await Promise.all([listInspections(), listJobs()]);
  const pending = jobs.filter((j) => j.job.kind === "inspect" && (j.status === "running" || j.status === "queued"));

  return (
    <div lang="es" className="flex flex-col gap-5">
      <AutoRefresh active={pending.length > 0} />
      <PageHeader
        title="Inspecciones"
        description="Revisiones de solo lectura de un sitio web con comprobaciones deterministas. Un hallazgo es VERIFIED solo si aparece en todas las repeticiones."
        actions={
          <ButtonLink href="/" variant="primary">
            <Plus /> Nueva inspección
          </ButtonLink>
        }
      />

      {pending.length > 0 && (
        <Panel title="En marcha" bodyClassName="p-0">
          <ul>
            {pending.map(({ job, status }) => (
              <li key={job.id} className="border-b border-line last:border-b-0">
                <Link href={`/jobs/${job.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                  <StatusPill status={status === "queued" ? "EN COLA" : "EN CURSO"} tone={status === "queued" ? "q" : "running"} size="xs" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{job.kind === "inspect" ? job.url : job.id}</span>
                  <span className="text-xs text-faint">{relativeTime(job.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`${inspections.length} ${inspections.length === 1 ? "inspección" : "inspecciones"}`} bodyClassName="p-0">
        {inspections.length === 0 ? (
          <EmptyState
            icon={<Globe />}
            title="Aún no hay inspecciones"
            action={
              <ButtonLink href="/" variant="primary">
                <Plus /> Inspeccionar un sitio
              </ButtonLink>
            }
          >
            Lanza una desde la página de inicio, o ejecuta <code className="font-mono">pnpm exegezis inspect --url https://…</code> en un terminal.
          </EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>Sitio</th>
                  <th className={tableClass.th}>Estado</th>
                  <th className={tableClass.th}>Verificados</th>
                  <th className={tableClass.th}>Intermitentes</th>
                  <th className={tableClass.th}>Páginas</th>
                  <th className={tableClass.th}>Fecha</th>
                  <th className={tableClass.th} aria-label="Abrir" />
                </tr>
              </thead>
              <tbody>
                {inspections.map((i) => {
                  const r = i.report.status === "ok" ? i.report.value : null;
                  const verified = r === null ? null : r.findings.filter((f) => f.verdict === "VERIFIED" && f.severity !== "info").length;
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
                          <StatusPill status={i.report.status === "missing" ? "MISSING" : "INVALID REPORT"} tone="bad" size="xs" />
                        ) : (
                          <StatusPill status={r.status} tone={INSPECTION_STATUS_TONE[r.status]} size="xs" />
                        )}
                      </td>
                      <td className={`${tableClass.td} font-mono`}>{verified ?? "—"}</td>
                      <td className={`${tableClass.td} font-mono`}>{r?.summary.intermittent ?? "—"}</td>
                      <td className={`${tableClass.td} font-mono`}>{r?.summary.pagesVisited ?? "—"}</td>
                      <td className={`${tableClass.td} whitespace-nowrap text-xs text-muted`}>{r === null ? "—" : relativeTime(r.finishedAt)}</td>
                      <td className={tableClass.td}>
                        <Link href={`/inspections/${i.id}`} aria-label={`Abrir la inspección ${i.id}`} className="text-faint hover:text-fg">
                          <ChevronRight className="size-4" />
                        </Link>
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
