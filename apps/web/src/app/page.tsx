import { ArrowRight, Beaker, Globe, LayoutList, Microscope } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { groupStats } from "@exegezis/core";
import { listTemplates } from "@exegezis/search/light";
import { InspectForm } from "@/components/home/inspect-form";
import { SearchForm, type TemplateOption } from "@/components/home/search-form";
import { EmptyState, Panel, TabLinks } from "@/components/ui/primitives";
import { EvidenceMeter, NotImplemented, ReplayTag, RunHistory, StatusPill, VerdictPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { buildCases, proofMetrics, type CaseGroup, type CaseRow } from "@/lib/evidence/cases";
import { listInspections } from "@/lib/evidence/inspections";
import { getRootCauses, getSummaries } from "@/lib/evidence/investigations";
import { latestPerCase } from "@/lib/evidence/root-causes";
import { NOT_IMPLEMENTED_STAGES, STAGES } from "@/lib/evidence/stages";
import { duration, haceTiempo } from "@/lib/format";
import { INSPECTION_STATUS_TONE } from "@/lib/inspection-labels";
import { getScope, inScope } from "@/lib/scope";

export const metadata: Metadata = { title: { absolute: "Inicio · EXEGEZIS" } };

const FILTERS: { id: "all" | CaseGroup; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "proven", label: "Demostrados" },
  { id: "pending", label: "Pendientes" },
  { id: "expected", label: "Esperados" },
];

const STAGE_ES: Record<string, { label: string; text: string }> = {
  symptom: { label: "Síntoma", text: "Descripción en lenguaje natural" },
  plan: { label: "Plan", text: "Plan de prueba escrito por la IA o por una persona" },
  reproduction: { label: "Reproducción", text: "Ejecución repetida en navegadores limpios" },
  evidence: { label: "Evidencia", text: "Trazas, red, consola, DOM y capturas" },
  investigation: { label: "Investigación", text: "Experimentos con mutaciones del código" },
  root_cause: { label: "Causa raíz", text: "Validada frente a las alternativas probadas" },
  fix: { label: "Arreglo", text: "Proponer y aplicar un cambio" },
  verification: { label: "Verificación del arreglo", text: "Antes y después del cambio" },
};

const LEVEL_ES = { NONE: "Ninguna", REPRODUCED: "Reproducido", SUFFICIENT: "Suficiente", CANDIDATE: "Candidata", VALIDATED: "Validada" } as const;

function Origin({ row }: { row: CaseRow }) {
  const o = row.origin;
  if (o.kind === "replay") return <ReplayTag title="Respuesta grabada del planner (mock): no es un resultado de IA en vivo">Replay</ReplayTag>;
  if (o.kind === "ai") return <span className="text-[12px] text-muted">IA · <span className="font-mono">{o.model}</span></span>;
  if (o.kind === "human") return <span className="text-[12px] text-muted">Plan humano</span>;
  return <span className="text-[12px] text-faint">—</span>;
}

function Metric({ label, value, secondary, tone }: { label: string; value: string | number; secondary: React.ReactNode; tone?: "bad" | "ok" | undefined }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-panel px-4 py-3.5">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className={cn("font-mono text-[28px] leading-tight font-semibold tracking-tight", tone === "bad" ? "text-bad" : "text-fg")}>{value}</div>
      <div className="text-[12px] text-muted">{secondary}</div>
    </div>
  );
}

function CaseItem({ row }: { row: CaseRow }) {
  const real = row.runs.filter((r) => !r.replay);
  const replays = row.runs.length - real.length;
  const href = `/investigations/${row.latest.ref.id}`;
  return (
    <li className="border-b border-line last:border-b-0">
      <div className="flex flex-col gap-2 px-4 py-3 hover:bg-hover/40">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1 basis-56">
            <Link href={href} className="block text-[13px] font-medium break-words text-fg hover:underline">
              {row.title}
            </Link>
            <div className="truncate font-mono text-[11px] text-faint">
              {row.caseId}
              {row.suite !== null && ` · ${row.suite}`}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {row.outcome === null ? <StatusPill status="NOT RUN" tone="q" size="xs" /> : <VerdictPill verdict={row.outcome} size="xs" />}
            {row.kind === "negative" && row.asExpected === false && (
              <span className="text-[11px] font-medium text-bad" title={`Se esperaba ${row.expected ?? "—"}`}>
                ≠ esperado ({row.expected?.replaceAll("_", " ")})
              </span>
            )}
            {row.kind === "negative" && row.asExpected === true && <span className="text-[11px] text-muted">= esperado</span>}
          </div>
        </div>
        {row.outcome !== "VERIFIED" && row.latest.outcomeReason !== null && (
          <p className="line-clamp-2 text-[12px] text-muted" title={row.latest.outcomeReason}>
            {row.latest.outcomeReason}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {row.kind === "negative" ? (
            <span className="text-[12px] text-faint" title="Un caso negativo no tiene bug que evidenciar">
              Evidencia —
            </span>
          ) : (
            <EvidenceMeter level={row.evidence} labels={LEVEL_ES} />
          )}
          <span className="inline-flex items-center gap-1.5">
            <RunHistory runs={real.map((r) => r.mark)} label="Ejecuciones" />
            {replays > 0 && <ReplayTag title={`${replays} ejecuciones con respuestas grabadas del planner, fuera de las métricas`}>+{replays} replay</ReplayTag>}
          </span>
          <Origin row={row} />
          <span className="text-[12px] text-muted sm:ml-auto">{haceTiempo(row.createdAt)}</span>
        </div>
      </div>
    </li>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [all, rootCauses, inspections, scope, params] = await Promise.all([getSummaries(), getRootCauses(), listInspections(), getScope(), searchParams]);
  const summaries = all.filter((s) => inScope(s, scope));
  const cases = buildCases(summaries);
  const m = proofMetrics(cases, summaries, latestPerCase(rootCauses));
  const filter = FILTERS.find((f) => f.id === params.casos)?.id ?? "all";
  const shown = filter === "all" ? cases : cases.filter((c) => c.group === filter);
  const count = (id: "all" | CaseGroup) => (id === "all" ? cases.length : cases.filter((c) => c.group === id).length);
  const tab = params.modo === "buscar" ? "search" : "inspect";
  const templates: TemplateOption[] =
    tab === "search"
      ? (await listTemplates().catch(() => [])).map((t) => ({ id: t.id, name: t.name, description: t.description, origin: t.origin, hasExact: t.exact !== null, hasMeaning: t.meaning !== null }))
      : [];

  const stageCounts = STAGES.map((stage) => {
    if (NOT_IMPLEMENTED_STAGES.includes(stage.id)) return { stage, count: null };
    const reached = cases.filter((c) => {
      const st = c.latest.stages.find((x) => x.id === stage.id);
      return st !== undefined && (st.tone === "ok" || st.tone === "warn");
    }).length;
    return { stage, count: reached };
  });

  return (
    <div lang="es" className="flex flex-col gap-8">
      <section aria-labelledby="home-title" className="rounded-xl border border-line bg-panel p-5 sm:p-7">
        <div className="-mx-5 -mt-5 mb-5 sm:-mx-7 sm:-mt-7">
          <TabLinks
            active={tab}
            tabs={[
              { id: "inspect", label: "Inspeccionar", href: "/" },
              { id: "search", label: "Buscar", href: "/?modo=buscar" },
            ]}
          />
        </div>
        <div className="text-[12px] font-semibold tracking-wider text-muted">{tab === "search" ? "BÚSQUEDA EN UN SITIO" : "INSPECCIÓN WEB"}</div>
        <h1 id="home-title" className="mt-1 text-[26px] font-semibold tracking-tight text-fg sm:text-[30px]">
          {tab === "search" ? "Busca lo que necesites en un sitio." : "Revisa cualquier página web."}
        </h1>
        <p className="mt-1 mb-5 max-w-2xl text-[14px] text-muted">
          {tab === "search"
            ? "Palabras exactas (sin IA, comprobadas en cada carga) o por significado (la IA propone y cada cita se verifica letra por letra en la página). Siempre verás cuántas páginas se revisaron."
            : "EXEGEZIS recorre el sitio en navegadores limpios, repite cada visita y solo marca como VERIFIED lo que aparece en todas las repeticiones, con su evidencia y un spec de Playwright."}
        </p>
        {tab === "search" ? <SearchForm templates={templates} /> : <InspectForm />}
        <Link href="/investigations/new" className="mt-4 inline-flex items-center gap-1 text-[13px] text-accent-text hover:underline">
          ¿Tienes un síntoma concreto? Abrir una investigación <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </section>

      <section aria-labelledby="proof-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="proof-title" className="text-[15px] font-semibold text-fg">
            Lo demostrado
          </h2>
          <span className="text-[12px] text-muted">Un valor por caso (su último resultado real). Las ejecuciones con respuestas grabadas (replay) no cuentan.</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Bugs verificados" value={m.verifiedBugs} secondary={`${m.reproductions} reproducciones · ${m.attempts} ejecuciones en navegador`} />
          <Metric
            label="Causas validadas"
            value={m.validatedCauses}
            secondary={
              <>
                frente a las alternativas probadas, en {m.rootCauseCases} casos
                {m.falseValidations > 0 && (
                  <>
                    {" · "}
                    <Link href="/verification/root-causes" className="font-medium text-bad underline">
                      {m.falseValidations} falsa{m.falseValidations === 1 ? "" : "s"} validaci{m.falseValidations === 1 ? "ón" : "ones"}
                    </Link>
                  </>
                )}
              </>
            }
          />
          <Metric
            label="Falsos VERIFIED en casos negativos"
            value={m.falseVerified}
            tone={m.falseVerified > 0 ? "bad" : undefined}
            secondary={`de ${m.negativeCases} casos negativos evaluados`}
          />
          <Metric
            label="Mediana hasta verificar"
            value={duration(m.medianMsToVerify)}
            secondary={m.timedCases === 0 ? "sin tiempos: los resultados archivados no guardan reproduction.json" : `sobre ${m.timedCases} bugs verificados (todas las ejecuciones)`}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel
          title="Actividad por caso"
          bodyClassName="p-0"
          actions={
            <Link href="/investigations" className="flex items-center gap-1 text-xs text-accent-text hover:underline">
              Todas las investigaciones <ArrowRight className="size-3" aria-hidden />
            </Link>
          }
        >
          <nav aria-label="Filtrar casos" className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
            {FILTERS.map((f) => (
              <Link
                key={f.id}
                href={f.id === "all" ? "/" : `/?casos=${f.id}`}
                scroll={false}
                aria-current={filter === f.id ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px]",
                  filter === f.id ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg",
                )}
              >
                {f.label}
                <span className="font-mono text-[11px] text-faint">{count(f.id)}</span>
              </Link>
            ))}
          </nav>
          {shown.length === 0 ? (
            <EmptyState icon={<LayoutList />} title={cases.length === 0 ? "Aún no hay casos" : "Ningún caso en este filtro"}>
              {cases.length === 0 ? (
                <>
                  Abre una investigación o ejecuta <code className="font-mono">pnpm exegezis benchmark --suite buggy-shop</code>.
                </>
              ) : (
                "Prueba con otro filtro."
              )}
            </EmptyState>
          ) : (
            <ul>
              {shown.map((row) => (
                <CaseItem key={row.key} row={row} />
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel
            title="Inspecciones recientes"
            icon={<Globe />}
            bodyClassName="p-0"
            actions={
              inspections.length > 0 ? (
                <Link href="/inspections" className="text-xs text-accent-text hover:underline">
                  Todas
                </Link>
              ) : undefined
            }
          >
            {inspections.length === 0 ? (
              <EmptyState icon={<Globe />} title="Todavía no has inspeccionado ningún sitio">
                Escribe una URL arriba. El resultado aparecerá aquí con sus hallazgos verificados.
              </EmptyState>
            ) : (
              <ul>
                {inspections.slice(0, 5).map((i) => {
                  const r = i.report.status === "ok" ? i.report.value : null;
                  const g = r === null ? null : groupStats(r.groups, r.findings);
                  return (
                    <li key={i.id} className="border-b border-line last:border-b-0">
                      <Link href={`/inspections/${i.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] text-fg">{r?.target.url ?? i.relDir}</div>
                          <div className="text-[11px] text-muted">
                            {r === null || g === null ? "informe no válido" : `${g.problems} problemas · ${g.elements} elementos · ${haceTiempo(r.finishedAt)}`}
                          </div>
                        </div>
                        {r === null ? <StatusPill status="INVALID" tone="bad" size="xs" /> : <StatusPill status={r.status} tone={INSPECTION_STATUS_TONE[r.status]} size="xs" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Qué puede demostrar hoy" bodyClassName="p-0">
            <ol>
              {stageCounts.map(({ stage, count: n }, i) => {
                const es = STAGE_ES[stage.id] ?? { label: stage.label, text: "" };
                return (
                  <li key={stage.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0">
                    <span className="w-5 font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-fg">{es.label}</div>
                      <div className="truncate text-[11px] text-muted">{es.text}</div>
                    </div>
                    {n === null ? <NotImplemented size="xs" /> : <span className="font-mono text-[12px] text-muted">{n} casos</span>}
                  </li>
                );
              })}
            </ol>
          </Panel>

          <nav aria-label="Atajos" className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-1">
            {[
              { href: "/investigations", label: "Investigaciones", icon: LayoutList },
              { href: "/verification/root-causes", label: "Causas raíz", icon: Microscope },
              { href: "/benchmarks", label: "Benchmarks", icon: Beaker },
            ].map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2.5 text-[13px] text-fg hover:bg-hover">
                <Icon className="size-4 text-muted" aria-hidden />
                {label}
                <ArrowRight className="ml-auto size-3.5 text-faint" aria-hidden />
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
