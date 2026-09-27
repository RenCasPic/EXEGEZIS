import { describeQuery, listSavedSearches } from "@exegezis/search/light";
import { Bookmark, ChevronRight, Play, Plus, Search, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { deleteSavedAction, runSavedAction } from "@/app/search-actions";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { buttonClass, ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { listSearches } from "@/lib/evidence/searches";
import { haceTiempo } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { SEARCH_STATUS_LABEL, SEARCH_STATUS_TONE } from "@/lib/search-labels";

export const metadata: Metadata = { title: "Búsquedas" };

const MODE_LABEL = { exact: "Exacta", meaning: "Por significado", template: "Plantilla" } as const;

export default async function SearchesPage() {
  const [searches, jobs, saved] = await Promise.all([listSearches(), listJobs(), listSavedSearches().catch(() => [])]);
  const pending = jobs.filter((j) => j.job.kind === "search" && (j.status === "running" || j.status === "queued"));

  return (
    <div lang="es" className="flex flex-col gap-5">
      <AutoRefresh active={pending.length > 0} />
      <PageHeader
        title="Búsquedas"
        description="Búsquedas en el texto de un sitio: exactas (sin IA, verificadas en cada carga) o por significado (la IA propone y cada cita se comprueba letra por letra en la página)."
        actions={
          <ButtonLink href="/?modo=buscar" variant="primary">
            <Plus /> Nueva búsqueda
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
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{job.kind === "search" ? job.url : job.id}</span>
                  <span className="text-xs text-faint">{haceTiempo(job.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`${searches.length} ${searches.length === 1 ? "búsqueda" : "búsquedas"}`} icon={<Search />} bodyClassName="p-0">
        {searches.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="Aún no hay búsquedas"
            action={
              <ButtonLink href="/?modo=buscar" variant="primary">
                <Plus /> Buscar en un sitio
              </ButtonLink>
            }
          >
            Lánzala desde la página de inicio (pestaña Buscar), o con <code className="font-mono">pnpm exegezis search --url https://… --terms &quot;a, b&quot;</code>.
          </EmptyState>
        ) : (
          <ul>
            {searches.map((s) => {
              const r = s.report.status === "ok" ? s.report.value : null;
              return (
                <li key={s.id} className="border-b border-line last:border-b-0">
                  <Link href={`/searches/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12px] text-fg">{r?.target.url ?? s.relDir}</div>
                      {r === null ? (
                        <div className="text-[12px] text-bad">informe no válido: no se muestra</div>
                      ) : (
                        <>
                          <div className="truncate text-[13px] text-fg" title={describeQuery(r)}>
                            <span className="text-muted">{MODE_LABEL[r.query.kind]}:</span> {describeQuery(r)}
                          </div>
                          <div className="text-[12px] text-muted">
                            {r.summary.hits} resultado{r.summary.hits === 1 ? "" : "s"} · se revisaron {r.coverage.searched} de {r.coverage.found} páginas · {haceTiempo(r.finishedAt)}
                          </div>
                        </>
                      )}
                    </div>
                    {r === null ? <StatusPill status="INVALID" tone="bad" size="xs" /> : <StatusPill status={SEARCH_STATUS_LABEL[r.status]} tone={SEARCH_STATUS_TONE[r.status]} size="xs" />}
                    <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel id="guardadas" title={`Búsquedas guardadas (${saved.length})`} icon={<Bookmark />} subtitle="se repiten con un clic y dicen qué es nuevo" bodyClassName="p-0">
        {saved.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted">Ninguna. Guarda una búsqueda desde su detalle, o al lanzarla (opciones avanzadas).</p>
        ) : (
          <ul>
            {saved.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1 basis-60">
                  <div className="text-[13px] font-medium text-fg">{s.name}</div>
                  <div className="truncate font-mono text-[12px] text-muted">{s.url}</div>
                  <div className="truncate text-[12px] text-muted">
                    {MODE_LABEL[s.query.kind]}: {describeQuery({ query: s.query })} · {s.lastRunAt === null ? "nunca repetida" : `última vez ${haceTiempo(s.lastRunAt)}`}
                  </div>
                </div>
                <form action={runSavedAction}>
                  <input type="hidden" name="saved" value={s.id} />
                  <button type="submit" className={buttonClass("primary", "sm")}>
                    <Play aria-hidden /> Repetir
                  </button>
                </form>
                <form action={deleteSavedAction}>
                  <input type="hidden" name="saved" value={s.id} />
                  <button type="submit" className={buttonClass("ghost", "sm")} aria-label={`Borrar la búsqueda guardada ${s.name}`}>
                    <Trash2 aria-hidden /> Borrar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
