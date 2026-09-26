import { SEVERITIES, type Finding, type InspectionReport } from "@exegezis/core";
import { AlertTriangle, Download, ExternalLink, FileCode2, Globe, ListChecks, Wrench } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FilterForm } from "@/components/inspection/filter-form";
import { buttonClass, CodeBlock, EmptyState, Meta, Mono, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import type { InspectionRef } from "@/lib/evidence/discover";
import { filterFindings, findInspection, loadFindingEvidence, pageRows, parseFindingFilters, sortFindings, type FindingEvidence } from "@/lib/evidence/inspections";
import { absoluteTime, duration } from "@/lib/format";
import { CHECK_LABEL, INSPECTION_STATUS_TEXT, INSPECTION_STATUS_TONE, PAGE_STATUS_TONE, SEVERITY_LABEL, SEVERITY_TONE, shortUrl } from "@/lib/inspection-labels";
import { artifactUrl } from "@/lib/urls";

export const metadata: Metadata = { title: "Inspección" };

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

function Occurrences({ finding, runs }: { finding: Finding; runs: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`Observado en ${finding.occurrences.length} de ${runs} repeticiones`}>
      <span className="sr-only">
        Observado en {finding.occurrences.length} de {runs} repeticiones
      </span>
      {Array.from({ length: runs }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={finding.occurrences.includes(i + 1) ? "size-2 rounded-full bg-fg/70" : "size-2 rounded-full border border-faint"}
        />
      ))}
      <span aria-hidden className="ml-1 font-mono text-[11px] text-muted">
        {finding.occurrences.length}/{runs}
      </span>
    </span>
  );
}

function EvidenceBlock({ id, finding, evidence }: { id: string; finding: Finding; evidence: FindingEvidence }) {
  const shots = finding.evidence.filter((e) => e.kind === "screenshot");
  const dom = finding.evidence.find((e) => e.kind === "dom");
  const trace = finding.evidence.find((e) => e.kind === "trace");
  return (
    <div className="flex flex-col gap-4">
      {evidence.pageErrors.map((e) => (
        <div key={e.id}>
          <h4 className="mb-1 text-xs font-medium text-muted">Excepción de la página</h4>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-code p-2 font-mono text-[11px] text-fg">
            {e.name}: {e.message}
            {e.stack === undefined ? "" : `\n${e.stack}`}
          </pre>
        </div>
      ))}
      {evidence.console.map((m) => (
        <div key={m.id}>
          <h4 className="mb-1 text-xs font-medium text-muted">Consola ({m.level})</h4>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-code p-2 font-mono text-[11px] text-fg">
            {m.text}
            {m.location === undefined ? "" : `\n  at ${m.location.url}:${m.location.line ?? "?"}`}
          </pre>
        </div>
      ))}
      {evidence.exchanges.map((x) => (
        <div key={x.id}>
          <h4 className="mb-1 text-xs font-medium text-muted">Petición y respuesta</h4>
          <div className="rounded-md border border-line bg-code p-2 font-mono text-[11px]">
            <div className="break-all text-fg">
              {x.request.method} {x.request.url}
            </div>
            <div className={x.response === undefined || x.response.status >= 400 ? "text-critical" : "text-positive"}>
              {x.response === undefined ? `sin respuesta: ${x.failure?.errorText ?? "desconocido"}` : `${x.response.status} ${x.response.statusText}`}
              <span className="text-faint"> · {x.request.resourceType}</span>
            </div>
            {x.response?.body?.captured === true && x.response.body.text !== undefined && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-line pt-2 text-muted">{x.response.body.text}</pre>
            )}
          </div>
        </div>
      ))}
      {shots.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {shots.map((s) => (
            <figure key={s.path} className="overflow-hidden rounded-md border border-line">
              {/* A local evidence file, served as-is. */}
              <img src={artifactUrl(id, s.path)} alt={s.description ?? "Captura de la página"} className="w-full bg-white" loading="lazy" />
              <figcaption className="border-t border-line px-2 py-1.5 text-[11px] text-faint">{s.description}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {dom !== undefined && (
        <details className="rounded-md border border-line">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted hover:text-fg">DOM capturado (marco aislado, sin scripts)</summary>
          <div className="border-t border-line">
            <iframe title={`DOM de ${finding.page}`} sandbox="" src={artifactUrl(id, dom.path)} className="h-80 w-full bg-white" loading="lazy" />
            <a href={artifactUrl(id, dom.path, { source: true })} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 py-2 text-xs text-accent hover:underline">
              Ver el código fuente <ExternalLink className="size-3" />
            </a>
          </div>
        </details>
      )}
      {trace !== undefined && (
        <a href={artifactUrl(id, trace.path)} className={buttonClass("secondary", "sm") + " self-start"}>
          <Download /> Trace de Playwright
        </a>
      )}
    </div>
  );
}

function FindingItem({ inspectionId, finding, report, evidence }: { inspectionId: string; finding: Finding; report: InspectionReport; evidence: FindingEvidence }) {
  return (
    <li className="border-b border-line last:border-b-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-hover/40 [&::-webkit-details-marker]:hidden">
          <StatusPill status={SEVERITY_LABEL[finding.severity]} tone={SEVERITY_TONE[finding.severity]} size="xs" />
          <span className="font-mono text-[11px] text-faint">{finding.id}</span>
          <span className="min-w-0 flex-1 basis-60 text-[13px] font-medium break-words text-fg">{finding.title}</span>
          <span className="text-xs text-muted">{CHECK_LABEL[finding.checkId] ?? finding.checkId}</span>
          <span className="font-mono text-[11px] text-muted">{shortUrl(finding.page, report.target.origin)}</span>
          <Occurrences finding={finding} runs={report.options.runs} />
        </summary>
        <div className="grid gap-5 border-t border-line bg-panel-2 px-4 py-4 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <h4 className="mb-1 text-xs font-medium text-muted">Detalle</h4>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-code p-2 font-mono text-[11px] text-fg">{finding.detail}</pre>
            </div>
            <div>
              <h4 className="mb-1 text-xs font-medium text-muted">Cómo reproducirlo</h4>
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-fg">
                {finding.reproduction.map((step, i) => (
                  <li key={i} className="break-words">
                    {step}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h4 className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted">
                Spec de Playwright
                {finding.spec !== null && (
                  <a href={artifactUrl(inspectionId, finding.spec, { download: true })} className={buttonClass("secondary", "sm")} download>
                    <Download /> Descargar
                  </a>
                )}
              </h4>
              {finding.spec === null ? (
                <p className="text-[13px] text-muted">
                  {finding.verdict === "INTERMITTENT"
                    ? "Sin spec: solo los hallazgos VERIFIED se compilan."
                    : "Sin spec: la comprobación de este hallazgo no se puede expresar como aserción."}
                </p>
              ) : evidence.spec === null ? (
                <p className="text-[13px] text-critical">El informe cita {finding.spec}, pero el archivo no existe.</p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-faint">Falla mientras el problema exista y pasa cuando se corrige. Usa BASE_URL para apuntarlo a otro entorno.</p>
                  <CodeBlock code={evidence.spec} maxHeight="18rem" />
                </>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <h4 className="mb-2 text-xs font-medium text-muted">Evidencia (primera observación)</h4>
            <EvidenceBlock id={inspectionId} finding={finding} evidence={evidence} />
          </div>
        </div>
      </details>
    </li>
  );
}

async function FindingList({ inspection, report, findings, empty }: { inspection: InspectionRef; report: InspectionReport; findings: Finding[]; empty: string }) {
  if (findings.length === 0) return <p className="px-4 py-6 text-[13px] text-muted">{empty}</p>;
  const evidence = await Promise.all(findings.map((f) => loadFindingEvidence(inspection, f)));
  return (
    <ul>
      {findings.map((f, i) => (
        <FindingItem key={f.id} inspectionId={inspection.id} finding={f} report={report} evidence={evidence[i] as FindingEvidence} />
      ))}
    </ul>
  );
}

export default async function InspectionPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const inspection = await findInspection(id);
  if (inspection === null) notFound();
  if (inspection.report.status !== "ok") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Informe de inspección no válido" eyebrow={<StatusPill status="INVALID REPORT" tone="critical" />} description={<Mono>{inspection.relDir}</Mono>} />
        <Panel title="Por qué no se muestra">
          {inspection.report.status === "missing" ? (
            <p className="text-[13px] text-muted">El archivo inspection-report.json ha desaparecido.</p>
          ) : (
            <>
              <p className="mb-2 text-[13px] text-muted">
                El informe no cumple su esquema, o sus veredictos y recuentos no se derivan de las observaciones registradas. No se muestra ni en parte.
              </p>
              <ul className="list-disc pl-5 font-mono text-[12px] text-critical">
                {inspection.report.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    );
  }

  const report = inspection.report.value;
  const filters = parseFindingFilters(await searchParams);
  const verified = sortFindings(report.findings.filter((f) => f.verdict === "VERIFIED"));
  const intermittent = sortFindings(report.findings.filter((f) => f.verdict === "INTERMITTENT"));
  const shown = filterFindings(verified, filters);
  const filtered = filters.severity !== null || filters.check !== null || filters.page !== null || filters.q !== "";
  const pages = pageRows(report);
  const checksWithFindings = [...new Set(report.findings.map((f) => f.checkId))].sort();
  const pagesWithFindings = [...new Set(report.findings.map((f) => f.page))].sort();
  const writes = report.pageWrites;
  const s = report.summary;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<StatusPill status={report.status} tone={INSPECTION_STATUS_TONE[report.status]} />}
        title={<span className="break-all font-mono text-[20px]">{report.target.url}</span>}
        description={
          <>
            {INSPECTION_STATUS_TEXT[report.status]} {absoluteTime(report.finishedAt)} · {duration(Date.parse(report.finishedAt) - Date.parse(report.startedAt))} ·{" "}
            <Mono>{inspection.id}</Mono>
          </>
        }
      />

      {writes.length > 0 && (
        <div role="alert" className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-[13px] text-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <strong className="font-semibold">
              La página hizo {writes.length} {writes.length === 1 ? "escritura" : "escrituras"} por su cuenta
              {report.options.strictReadonly ? ", y todas se bloquearon (--strict-readonly)." : "."}
            </strong>{" "}
            {report.options.strictReadonly
              ? `Las páginas afectadas quedan DEGRADED y sus hallazgos se descartan (${s.discardedByPolicy} observaciones).`
              : "La inspección no envía formularios ni pulsa botones; estas peticiones las lanzó el código de la propia página al cargar. Si no deben llegar al servidor, repite con --strict-readonly."}{" "}
            <a href="#page-writes" className="text-accent underline">
              Ver las escrituras
            </a>
          </div>
        </div>
      )}

      <section aria-label="Resumen por severidad" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {SEVERITIES.map((sev) => (
          <Stat key={sev} label={`${SEVERITY_LABEL[sev]} · verificados`} value={s.verified[sev]} />
        ))}
        <Stat label="Intermitentes" value={s.intermittent} hint="aparte, sin spec" />
      </section>

      <Panel
        title={`Hallazgos verificados (${verified.length})`}
        icon={<ListChecks />}
        subtitle={`presentes en ${report.options.runs}/${report.options.runs} repeticiones`}
        bodyClassName="p-0"
      >
        {verified.length > 0 && (
          <div className="border-b border-line px-4 py-3">
            <Suspense>
              <FilterForm
                selects={[
                  { name: "severity", label: "Severidad", options: [{ value: "", label: "Todas" }, ...SEVERITIES.map((v) => ({ value: v, label: SEVERITY_LABEL[v] }))] },
                  { name: "check", label: "Comprobación", options: [{ value: "", label: "Todas" }, ...checksWithFindings.map((c) => ({ value: c, label: CHECK_LABEL[c] ?? c }))] },
                  { name: "page", label: "Página", options: [{ value: "", label: "Todas" }, ...pagesWithFindings.map((p) => ({ value: p, label: shortUrl(p, report.target.origin) }))] },
                ]}
              />
            </Suspense>
            {filtered && (
              <p className="mt-2 text-xs text-muted" aria-live="polite">
                {shown.length} de {verified.length} con estos filtros.
              </p>
            )}
          </div>
        )}
        {verified.length === 0 ? (
          <EmptyState title={report.status === "COMPLETED" || report.status === "PARTIAL" ? "Ningún hallazgo verificado" : "Sin hallazgos: no se pudo inspeccionar"}>
            {report.status === "COMPLETED" || report.status === "PARTIAL"
              ? "Ninguna comprobación encontró un problema en todas las repeticiones. Esto no significa que el sitio no tenga bugs: las comprobaciones genéricas no detectan errores de lógica."
              : INSPECTION_STATUS_TEXT[report.status]}
          </EmptyState>
        ) : (
          <FindingList inspection={inspection} report={report} findings={shown} empty="Ningún hallazgo coincide con los filtros." />
        )}
      </Panel>

      <Panel title={`Intermitentes (${intermittent.length})`} subtitle="observados solo en algunas repeticiones; no son VERIFIED" bodyClassName="p-0">
        <FindingList inspection={inspection} report={report} findings={intermittent} empty="Ninguno: todo lo observado apareció en todas las repeticiones o en ninguna." />
      </Panel>

      <Panel id="page-writes" title={`Escrituras de la página (${writes.length})`} icon={<AlertTriangle />} subtitle="peticiones no-GET lanzadas por la propia página" bodyClassName="p-0">
        {writes.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted">La página no hizo ninguna petición de escritura durante la inspección.</p>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>Método</th>
                  <th className={tableClass.th}>URL</th>
                  <th className={tableClass.th}>Estado</th>
                  <th className={tableClass.th}>Página de origen</th>
                  <th className={tableClass.th}>Repetición</th>
                </tr>
              </thead>
              <tbody>
                {writes.map((w, i) => (
                  <tr key={i} className={tableClass.tr}>
                    <td className={`${tableClass.td} font-mono`}>{w.method}</td>
                    <td className={`${tableClass.td} break-all font-mono text-[12px]`}>{w.url}</td>
                    <td className={`${tableClass.td} font-mono`}>{w.blocked ? <span className="text-warning">bloqueada</span> : (w.status ?? "—")}</td>
                    <td className={`${tableClass.td} font-mono text-[12px]`}>{shortUrl(w.page, report.target.origin)}</td>
                    <td className={`${tableClass.td} font-mono`}>{w.run}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title={`Páginas (${pages.length})`} icon={<Globe />} bodyClassName="p-0">
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>Página</th>
                  <th className={tableClass.th}>Estado</th>
                  <th className={tableClass.th}>HTTP</th>
                  <th className={tableClass.th}>Visitas</th>
                  <th className={tableClass.th}>Verificados</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.url} className={tableClass.tr}>
                    <td className={`${tableClass.td} break-all font-mono text-[12px]`}>
                      {shortUrl(p.url, report.target.origin)}
                      {p.reason !== null && <div className="mt-0.5 font-sans text-[11px] break-words text-faint">{p.reason}</div>}
                    </td>
                    <td className={tableClass.td}>
                      <StatusPill status={p.status} tone={PAGE_STATUS_TONE[p.status as keyof typeof PAGE_STATUS_TONE]} size="xs" />
                    </td>
                    <td className={`${tableClass.td} font-mono`}>{p.httpStatus ?? "—"}</td>
                    <td className={`${tableClass.td} font-mono`}>
                      {p.runs}/{report.options.runs}
                    </td>
                    <td className={`${tableClass.td} font-mono`}>{p.findings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Configuración y herramientas" icon={<Wrench />}>
            <Meta
              items={[
                { label: "Modo", value: report.options.strictReadonly ? "solo lectura estricto" : "solo lectura" },
                { label: "Presupuesto", value: `${report.options.maxPages} páginas · profundidad ${report.options.maxDepth} · ${report.options.runs} repeticiones` },
                {
                  label: "robots.txt",
                  value: report.robots.respected
                    ? `respetado${report.robots.fetched ? "" : " (no encontrado)"}${report.robots.disallow.length > 0 ? ` · Disallow ${report.robots.disallow.join(", ")}` : ""}`
                    : "ignorado (--ignore-robots)",
                },
                { label: "Sesión", value: report.options.storageState ? "storageState (no se registra su contenido)" : "ninguna" },
                { label: "User-Agent", value: <Mono>{report.tools.userAgent}</Mono> },
                { label: "Playwright", value: <Mono>{report.tools.playwright}</Mono> },
                { label: "axe-core", value: report.tools.axe === null ? "—" : <Mono>{`${report.tools.axe} · ${report.tools.axeRules.length} reglas`}</Mono> },
                { label: "Comprobaciones", value: <Mono>{report.tools.checks.map((c) => `${c.id}@${c.version}`).join(", ")}</Mono> },
                ...(report.totalTimeoutReached ? [{ label: "Tiempo total", value: <span className="text-warning">agotado</span> }] : []),
              ]}
            />
            <a href={artifactUrl(inspection.id, "inspection-report.json")} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-1 text-xs text-accent hover:underline">
              <FileCode2 className="size-3.5" /> inspection-report.json
            </a>
          </Panel>

          <Panel title={`Enlaces externos (${report.externalLinks.length})`} subtitle="listados, no visitados ni comprobados" bodyClassName="p-0">
            {report.externalLinks.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">Ninguno.</p>
            ) : (
              <ul className="max-h-72 overflow-auto">
                {report.externalLinks.map((l) => (
                  <li key={`${l.url} ${l.from}`} className="border-b border-line px-4 py-2 last:border-b-0">
                    <div className="break-all font-mono text-[12px] text-fg">{l.url}</div>
                    <div className="font-mono text-[11px] text-faint">desde {shortUrl(l.from, report.target.origin)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
