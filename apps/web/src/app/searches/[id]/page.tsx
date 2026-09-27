import { queryParts } from "@exegezis/core";
import { compareSearches, describeQuery, markOf } from "@exegezis/search/light";
import { Bookmark, Bot, Download, FileCode2, Layers, RotateCw, Search as SearchIcon, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { approveCostAction, repeatSearchAction, saveSearchAction } from "@/app/search-actions";
import { BlockNotice } from "@/components/access/block-notice";
import { HitCard } from "@/components/search/hit-card";
import { EngineProblem } from "@/components/ui/copy-command";
import { FilterForm } from "@/components/ui/filter-form";
import { buttonClass, EmptyState, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { accessEntry } from "@/lib/access";
import { filterHits, findSearch, groupHits, loadReview, parseHitFilters, previousRun, visitShots } from "@/lib/evidence/searches";
import { absoluteTime, duration } from "@/lib/format";
import { PAGE_STATUS_TONE, shortUrl } from "@/lib/inspection-labels";
import { SEARCH_STATUS_LABEL, SEARCH_STATUS_TEXT, SEARCH_STATUS_TONE, usd } from "@/lib/search-labels";
import { artifactUrl } from "@/lib/urls";

export const metadata: Metadata = { title: "Búsqueda" };

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const input = "h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-fg";

export default async function SearchPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const ref = await findSearch(id);
  if (ref === null) notFound();
  if (ref.report.status !== "ok") {
    return (
      <div lang="es" className="flex flex-col gap-6">
        <PageHeader title="Informe de búsqueda no válido" eyebrow={<StatusPill status="INVALID REPORT" tone="bad" />} description={<Mono>{ref.relDir}</Mono>} />
        <Panel title="Por qué no se muestra">
          {ref.report.status === "missing" ? (
            <p className="text-[13px] text-muted">El archivo search-report.json ha desaparecido.</p>
          ) : (
            <>
              <p className="mb-2 text-[13px] text-muted">
                El informe no cumple su esquema, o sus resultados, veredictos, citas o cobertura no se derivan de lo registrado (por ejemplo, una cita que no está en el texto de la página). No se muestra ni en parte.
              </p>
              <ul className="list-disc pl-5 font-mono text-[12px] text-bad">
                {ref.report.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    );
  }

  const report = ref.report.value;
  const query = await searchParams;
  const filters = parseHitFilters(query);
  const [review, previous] = await Promise.all([loadReview(ref), previousRun(ref)]);
  const comparison = previous === null ? null : compareSearches(report, previous.report);
  const shown = filterHits(report.hits, filters, review, comparison);
  const groups = groupHits(shown, filters.group);
  const shots = await visitShots(ref, shown.map((h) => h.runPath).filter((p) => p !== null));
  const cov = report.coverage;
  const s = report.summary;
  const entryBlock = report.pages.find((p) => p.depth === 0 && p.run === 1)?.block ?? null;
  const savedAccess = entryBlock === null ? null : await accessEntry(report.target.origin);
  const ai = report.ai;
  const parts = queryParts(report.query);
  const firstRun = report.pages.filter((p) => p.run === 1);
  const newCount = comparison === null ? 0 : [...comparison.novelty.values()].filter((n) => n === "new").length;
  const filtered = filters.verdict !== "all" || filters.mark !== "all" || filters.onlyNew || filters.q !== "";

  return (
    <div lang="es" className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<StatusPill status={SEARCH_STATUS_LABEL[report.status]} tone={SEARCH_STATUS_TONE[report.status]} />}
        title={<span className="break-all font-mono text-[20px]">{report.target.url}</span>}
        description={
          <>
            <span className="block text-fg">
              {report.query.kind === "exact" ? "Búsqueda exacta" : report.query.kind === "meaning" ? "Búsqueda por significado" : `Plantilla «${report.query.name}» v${report.query.version}`}: <strong>{describeQuery(report)}</strong>
            </span>
            {SEARCH_STATUS_TEXT[report.status]} {absoluteTime(report.finishedAt)} · {duration(Date.parse(report.finishedAt) - Date.parse(report.startedAt))} · <Mono>{ref.id}</Mono>
            {report.access.session || report.access.httpCredentials || report.access.wafToken ? " · con sesión" : ""}
          </>
        }
        actions={
          <form action={repeatSearchAction}>
            <input type="hidden" name="search" value={ref.id} />
            <button type="submit" className={buttonClass("secondary")}>
              <RotateCw aria-hidden /> Repetir
            </button>
          </form>
        }
      />

      {report.engineError !== null && (
        <EngineProblem
          message={`Ningún navegador pudo arrancar en este equipo, así que no se visitó ninguna página: no se buscó nada en ${report.target.origin}.`}
          remedy={report.engineError.remedy}
          detail={[report.engineError.message, ...report.engineError.attempts.map((a) => `${a.engine}: ${a.error}`)]}
        />
      )}
      {entryBlock !== null && <BlockNotice block={entryBlock} origin={report.target.origin} inspectionId={ref.id} relaunchJobId={null} hasWafToken={savedAccess?.kinds.includes("wafToken") === true} />}

      <section aria-label="Cobertura" className="rounded-lg border border-line bg-panel p-4">
        <p className="text-[15px] font-semibold text-fg">
          Se revisaron {cov.searched} de {cov.found} página{cov.found === 1 ? "" : "s"} encontrada{cov.found === 1 ? "" : "s"}.
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
          <li>
            {report.options.maxPages} páginas como máximo, profundidad {report.options.maxDepth}, {report.options.runs} carga{report.options.runs === 1 ? "" : "s"} por página
          </li>
          {cov.skippedBudget > 0 && <li className="text-warn">{cov.skippedBudget} fuera del límite de páginas</li>}
          {cov.skippedRobots > 0 && <li>{cov.skippedRobots} excluidas por robots.txt</li>}
          {cov.skippedSafety > 0 && <li>{cov.skippedSafety} enlaces omitidos por seguridad (cerrar sesión, borrar…)</li>}
          {cov.blocked.length > 0 && <li className="text-warn">{cov.blocked.length} bloqueadas ({[...new Set(cov.blocked.map((b) => b.kind))].join(", ")})</li>}
          {cov.failed > 0 && <li className="text-warn">{cov.failed} no respondieron</li>}
          {report.options.includeHidden ? <li>incluye texto no visible (marcado)</li> : <li>sin texto no visible</li>}
        </ul>
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] text-accent-text">Ver las páginas</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {firstRun.map((p) => (
              <li key={p.url} className="flex min-w-0 items-center gap-2 text-[12px]">
                <StatusPill status={p.status} tone={PAGE_STATUS_TONE[p.status]} size="xs" />
                <span className="min-w-0 truncate font-mono text-muted" title={p.url}>
                  {shortUrl(p.url, report.target.origin)}
                </span>
                <span className="shrink-0 text-faint">{report.hits.filter((h) => h.page === p.url).length} resultados</span>
              </li>
            ))}
          </ul>
        </details>
        <p className="mt-3 text-[13px] text-fg">
          <strong>{s.hits}</strong> resultado{s.hits === 1 ? "" : "s"} en {s.pagesWithHits} página{s.pagesWithHits === 1 ? "" : "s"}: {s.verified} verificado{s.verified === 1 ? "" : "s"}, {s.intermittent} intermitente{s.intermittent === 1 ? "" : "s"}
          {parts.meaning !== null && `, ${s.suggested} sugerencia${s.suggested === 1 ? "" : "s"} con cita verificada`}
          {s.hidden > 0 && ` · ${s.hidden} en texto no visible`}
          {s.byVariant > 0 && ` · ${s.byVariant} por variante`}.
        </p>
        {report.excluded.map((e) => (
          <p key={e.term} className="mt-1 text-[13px] text-muted">
            Excluidos por «{e.term}» ({e.scope === "block" ? "solo el bloque" : "página entera"}): {e.hits} resultado{e.hits === 1 ? "" : "s"} en {e.blocks} bloque{e.blocks === 1 ? "" : "s"} de {e.pages} página{e.pages === 1 ? "" : "s"}.
          </p>
        ))}
        {parts.exact?.variants === true && <p className="mt-1 text-[12px] text-muted">Con variantes (raíz Snowball): cada resultado por variante dice qué raíz lo unió. Puede unir palabras distintas (casa/caso).</p>}
      </section>

      {ai !== null && (
        <Panel title="Parte por significado (IA)" icon={<Bot />}>
          {report.status === "COST_LIMIT" && ai.calls === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-[14px] text-fg">
                Costaría hasta <strong>{usd(ai.estimateUsd)}</strong> y el límite es {usd(ai.maxCostUsd)}. No se envió nada a la IA.
              </p>
              <form action={approveCostAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="search" value={ref.id} />
                <button type="submit" className={buttonClass("primary")}>
                  Aprobar {usd(ai.estimateUsd)} y continuar
                </button>
                <span className="text-[12px] text-muted">Se reutilizan las páginas ya leídas: el sitio no se vuelve a visitar. El límite por defecto se cambia en Ajustes → Búsquedas.</span>
              </form>
            </div>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px] text-fg">
              <li>
                {ai.model} · {ai.calls} llamada{ai.calls === 1 ? "" : "s"} · {ai.inputTokens.toLocaleString("es-ES")} tokens de entrada, {ai.outputTokens.toLocaleString("es-ES")} de salida · {(ai.latencyMs / 1000).toFixed(1)} s
              </li>
              <li>
                Coste: <strong>{usd(ai.costUsd)}</strong> (estimado antes: hasta {usd(ai.estimateUsd)}; límite {usd(ai.maxCostUsd)}) · prompt {ai.promptVersion}
              </li>
              <li>
                {ai.pagesSent.length} página{ai.pagesSent.length === 1 ? "" : "s"} enviada{ai.pagesSent.length === 1 ? "" : "s"}
                {ai.redactions > 0 && ` · ${ai.redactions} bloques con datos personales o secretos redactados antes de enviar`}
              </li>
              {s.discardedQuotes > 0 && (
                <li className="text-warn">
                  {s.discardedQuotes} cita{s.discardedQuotes === 1 ? "" : "s"} de la IA descartada{s.discardedQuotes === 1 ? "" : "s"}: no aparecía{s.discardedQuotes === 1 ? "" : "n"} literalmente en la página. No se muestra{s.discardedQuotes === 1 ? "" : "n"}.
                </li>
              )}
              {ai.error !== null && <li className="text-bad">{ai.error}</li>}
              <li className="text-muted">La búsqueda por significado puede no encontrarlo todo (falsos negativos). Sus resultados son sugerencias con la cita verificada, nunca «verificados».</li>
            </ul>
          )}
        </Panel>
      )}

      <Panel
        title={filtered ? `Resultados (${shown.length} de ${report.hits.length})` : `Resultados (${report.hits.length})`}
        icon={<SearchIcon />}
        bodyClassName="p-0"
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <a href={`/api/searches/${encodeURIComponent(ref.id)}/export?format=csv&sep=%3B`} className={buttonClass("ghost", "sm")}>
              <Download aria-hidden /> CSV (Excel)
            </a>
            <a href={`/api/searches/${encodeURIComponent(ref.id)}/export?format=csv&sep=%2C`} className={buttonClass("ghost", "sm")} title="Separado por comas">
              CSV ,
            </a>
            <a href={`/api/searches/${encodeURIComponent(ref.id)}/export?format=pdf`} className={buttonClass("ghost", "sm")}>
              <Download aria-hidden /> PDF
            </a>
          </div>
        }
      >
        {report.hits.length > 0 && (
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
            <Suspense>
              <FilterForm
                placeholder="Filtrar por texto, página o término"
                selects={[
                  {
                    name: "tipo",
                    label: "Tipo",
                    options: [
                      { value: "", label: "Todos" },
                      { value: "verificados", label: "Verificados" },
                      { value: "intermitentes", label: "Intermitentes" },
                      ...(parts.meaning === null ? [] : [{ value: "sugerencias", label: "Sugerencias (IA)" }]),
                    ],
                  },
                  {
                    name: "revision",
                    label: "Revisión",
                    options: [
                      { value: "", label: "Todas" },
                      { value: "relevante", label: "Relevante" },
                      { value: "no-relevante", label: "No relevante" },
                      { value: "pendiente", label: "Pendiente" },
                    ],
                  },
                  {
                    name: "agrupar",
                    label: "Agrupar",
                    options: [
                      { value: "", label: "Por página" },
                      { value: "termino", label: "Por término" },
                    ],
                  },
                  ...(comparison === null
                    ? []
                    : [
                        {
                          name: "nuevo",
                          label: "Novedad",
                          options: [
                            { value: "", label: "Todo" },
                            { value: "1", label: `Solo lo nuevo (${newCount})` },
                          ],
                        },
                      ]),
                ]}
              />
            </Suspense>
            {comparison !== null && previous !== null && (
              <p className="text-[12px] text-muted">
                Frente a la ejecución anterior de esta búsqueda guardada (<Link href={`/searches/${previous.ref.id}`} className="text-accent-text hover:underline">{previous.ref.id}</Link>): {newCount} nuevo{newCount === 1 ? "" : "s"}, {comparison.gone.length} ya no aparece{comparison.gone.length === 1 ? "" : "n"}.
              </p>
            )}
          </div>
        )}

        {report.hits.length === 0 ? (
          <EmptyState icon={<SearchIcon />} title={`0 coincidencias en ${cov.searched} página${cov.searched === 1 ? "" : "s"} revisada${cov.searched === 1 ? "" : "s"}`}>
            {cov.searched === 0
              ? "No se pudo revisar ninguna página: mira el estado y la cobertura arriba."
              : `Se buscó en ${cov.searched} de ${cov.found} páginas encontradas${cov.skippedBudget > 0 ? `; ${cov.skippedBudget} quedaron fuera del límite` : ""}. Que no haya coincidencias aquí no significa que no existan en el resto del sitio.`}
          </EmptyState>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted">Ningún resultado con estos filtros.</p>
        ) : (
          <div>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.key} className="border-b border-line last:border-b-0">
                <h3 className="flex items-center gap-2 bg-sunken px-4 py-2 text-[12px] font-semibold text-fg">
                  <Layers className="size-3.5 text-muted" aria-hidden />
                  <span className="min-w-0 break-all">{filters.group === "page" ? shortUrl(g.key, report.target.origin) : g.key}</span>
                  <span className="font-mono text-[11px] font-normal text-faint">{g.hits.length}</span>
                </h3>
                {g.hits.map((h) => (
                  <HitCard
                    key={h.id}
                    searchId={ref.id}
                    hit={h}
                    runs={report.options.runs}
                    mark={markOf(review, h)}
                    shot={h.runPath === null ? null : (shots.get(h.runPath) ?? null)}
                    novelty={comparison?.novelty.get(h.id) ?? null}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
        {filters.onlyNew && comparison !== null && comparison.gone.length > 0 && (
          <div className="border-t border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold text-fg">Ya no aparecen ({comparison.gone.length})</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {comparison.gone.map((h) => (
                <li key={h.id} className="text-[12px] text-muted">
                  <span className="font-mono">{shortUrl(h.page, report.target.origin)}</span> — «{h.quote}»
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Guardar esta búsqueda" icon={<Bookmark />}>
          {report.savedSearchId !== null ? (
            <p className="text-[13px] text-muted">
              Es una búsqueda guardada: repítela desde <Link href="/searches#guardadas" className="text-accent-text hover:underline">Búsquedas guardadas</Link> y verás qué es nuevo.
            </p>
          ) : (
            <form action={saveSearchAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="search" value={ref.id} />
              <label htmlFor="save-name" className="sr-only">
                Nombre
              </label>
              <input id="save-name" name="name" required maxLength={200} placeholder="Nombre, p. ej. Salud en la web" className={input} />
              <button type="submit" className={buttonClass("secondary")}>
                Guardar
              </button>
            </form>
          )}
        </Panel>
        <Panel title="Herramientas" icon={<ShieldCheck />}>
          <ul className="flex flex-col gap-1 text-[13px] text-muted">
            <li>Modo: {report.options.strictReadonly ? "solo lectura estricta" : "solo lectura"} · robots.txt {report.robots.respected ? "respetado" : "ignorado"}</li>
            {report.tools.browser !== null && (
              <li>
                Navegador: <Mono>{`${report.tools.browser.channel} ${report.tools.browser.version}`}</Mono>
              </li>
            )}
            {report.tools.stemmer !== null && (
              <li>
                Variantes: <Mono>{report.tools.stemmer}</Mono>
              </li>
            )}
            <li>
              <a href={artifactUrl(ref.id, "search-report.json")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">
                <FileCode2 className="size-3.5" aria-hidden /> search-report.json
              </a>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
