import { ArrowRight, TerminalSquare } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { EngineProblem } from "@/components/ui/copy-command";
import { BROWSER_REMEDY } from "@/lib/browser-check";
import { ButtonLink, CodeBlock, Meta, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { inspectionJobState } from "@/lib/inspection-state";
import { listInspections } from "@/lib/evidence/inspections";
import { getSummaries } from "@/lib/evidence/investigations";
import { absoluteTime, duration } from "@/lib/format";
import { EXIT_MEANING, jobLog, jobProgress, readJob, terminalCommand, type InspectJob, type InspectionProgressFile, type JobStatus } from "@/lib/jobs";

export const metadata: Metadata = { title: "Run" };

const PHASE: Record<string, string> = {
  robots: "Leyendo robots.txt",
  crawl: "Recorriendo el sitio",
  repeat: "Repitiendo las visitas",
  specs: "Generando specs",
  done: "Terminado",
};

function Progress({ progress }: { progress: InspectionProgressFile | null }) {
  if (progress === null) return <p className="text-[13px] text-muted">Esperando el primer informe de progreso del CLI…</p>;
  const planned = Math.max(progress.pagesPlanned, 1);
  const pct = Math.min(100, Math.round((progress.pagesDone / planned) * 100));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
        <span className="font-medium text-fg">{PHASE[progress.phase] ?? progress.phase}</span>
        <span className="font-mono text-xs text-muted">
          repetición {progress.run}/{progress.runs} · {progress.pagesDone}/{progress.pagesPlanned} páginas
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Páginas de esta repetición">
        <div className="h-full bg-q transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      {progress.current !== null && <div className="truncate font-mono text-[11px] text-faint" title={progress.current}>{progress.current}</div>}
    </div>
  );
}

async function InspectJobView({ job, status, log }: { job: InspectJob; status: JobStatus; log: string | null }) {
  const [progress, inspections] = await Promise.all([jobProgress(job.id), listInspections()]);
  const inspection = inspections.find((i) => i.jobId === job.id) ?? null;
  const report = inspection?.report.status === "ok" ? inspection.report.value : null;
  const state = inspectionJobState(status, job.exitCode, report?.status ?? null);
  const active = status === "running" || status === "queued";
  const elapsed = (job.finishedAt === null ? Date.now() : Date.parse(job.finishedAt)) - Date.parse(job.startedAt);

  return (
    <div lang="es" className="flex flex-col gap-6">
      <AutoRefresh active={active} />
      <PageHeader
        eyebrow={<StatusPill status={state.label} tone={state.tone} />}
        title={<span className="break-all font-mono text-[20px]">{job.url}</span>}
        description={
          status === "queued"
            ? "Otra inspección está en curso; esta empieza en cuanto termine."
            : status === "running"
              ? "El CLI está inspeccionando el sitio. Esta página sigue su progreso."
              : status === "lost"
                ? "El proceso ya no existe y no informó de su salida (probablemente se reinició el servidor de la UI). Sus artefactos, si los hay, se conservan."
                : state.label === "BLOCKED"
                  ? "El sitio bloqueó la inspección (anti-bot, CAPTCHA o login). EXEGEZIS no intenta saltarse ese bloqueo."
                  : state.label === "ENGINE_ERROR"
                    ? "El navegador no pudo arrancar en este equipo. El problema está en este equipo, no en el sitio: no se sacó ninguna conclusión sobre él."
                    : undefined
        }
        actions={
          inspection !== null ? (
            <ButtonLink href={`/inspections/${inspection.id}`} variant="primary">
              Abrir informe <ArrowRight />
            </ButtonLink>
          ) : undefined
        }
      />
      {state.label === "ENGINE_ERROR" && (
        <EngineProblem
          message={report?.engineError?.message ?? "Ningún navegador pudo arrancar (código de salida 7)."}
          remedy={report?.engineError?.remedy ?? BROWSER_REMEDY}
          {...(report?.engineError === undefined || report.engineError === null ? {} : { detail: report.engineError.attempts.map((a) => `${a.engine}: ${a.error}`) })}
        />
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {active && (
            <Panel title="Progreso" subtitle="progress.json">
              <Progress progress={progress} />
            </Panel>
          )}
          <Panel title="Salida del CLI" icon={<TerminalSquare />} subtitle="output.log" bodyClassName="p-0">
            {log === null || log.trim() === "" ? (
              <div className="p-4 text-[13px] text-muted">{status === "queued" ? "En cola: aún no hay salida." : "Todavía no hay salida."}</div>
            ) : (
              <CodeBlock code={log} lineNumbers={false} className="rounded-none border-0" maxHeight="36rem" />
            )}
          </Panel>
        </div>
        <Panel title="Inspección">
          <Meta
            items={[
              { label: "Job", value: <Mono>{job.id}</Mono> },
              { label: "Repeticiones", value: job.runs },
              { label: "Páginas", value: job.maxPages ?? "20 (por defecto)" },
              { label: "Profundidad", value: job.maxDepth ?? "2 (por defecto)" },
              { label: "Checks", value: job.checks?.join(", ") ?? "todos" },
              { label: "Modo", value: job.strictReadonly ? "solo lectura estricto" : "solo lectura" },
              { label: "robots.txt", value: job.ignoreRobots ? "ignorado" : "respetado" },
              { label: "Navegador", value: job.browserChannel === "auto" ? "automático" : job.browserChannel },
              { label: "Sesión", value: job.storageState === null ? "ninguna" : "storageState (el contenido no se lee)" },
              { label: "Inicio", value: absoluteTime(job.startedAt) },
              { label: "Duración", value: duration(elapsed) },
              { label: "Código de salida", value: job.exitCode === null ? "—" : `${job.exitCode} (${EXIT_MEANING[job.exitCode] ?? "unknown"})` },
              ...(job.error === null ? [] : [{ label: "Error", value: <span className="text-bad">{job.error}</span> }]),
            ]}
          />
          <div className="mt-4 text-xs text-faint">La misma inspección desde un terminal:</div>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-code p-2 font-mono text-[11px] text-muted">{terminalCommand(job)}</pre>
        </Panel>
      </div>
    </div>
  );
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await readJob(id);
  if (found === null) notFound();
  const { job, status } = found;
  const log = await jobLog(id);
  if (job.kind === "inspect") return <InspectJobView job={job} status={status} log={log} />;

  const summaries = await getSummaries();
  const investigation = summaries.find((s) => s.ref.jobId === id) ?? null;
  const tone = status === "running" ? "running" : status === "finished" ? (job.exitCode === 0 ? "ok" : "q") : "bad";
  const elapsed = (job.finishedAt === null ? Date.now() : Date.parse(job.finishedAt)) - Date.parse(job.startedAt);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={status === "running"} />
      <PageHeader
        eyebrow={<StatusPill status={status.toUpperCase()} tone={tone} />}
        title={job.symptom.split("\n")[0] ?? job.symptom}
        description={
          status === "running"
            ? "The CLI is running. This page follows its output and links the investigation as soon as its artifacts exist."
            : status === "lost"
              ? "The process is gone and never reported an exit code (the UI server was probably restarted). Its artifacts, if any, are kept."
              : undefined
        }
        actions={
          investigation !== null ? (
            <ButtonLink href={`/investigations/${investigation.ref.id}`} variant="primary">
              Open investigation <ArrowRight />
            </ButtonLink>
          ) : undefined
        }
      />
      {job.exitCode === 7 && (
        <div lang="es">
          <EngineProblem message="Ningún navegador pudo arrancar (código de salida 7): no se sacó ninguna conclusión sobre la aplicación. El detalle está en la salida del CLI." remedy={BROWSER_REMEDY} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel title="CLI output" icon={<TerminalSquare />} subtitle="output.log" bodyClassName="p-0">
          {log === null || log.trim() === "" ? (
            <div className="p-4 text-[13px] text-muted">No output yet.</div>
          ) : (
            <CodeBlock code={log} lineNumbers={false} className="rounded-none border-0" maxHeight="36rem" />
          )}
        </Panel>
        <Panel title="Run">
          <Meta
            items={[
              { label: "Job", value: <Mono>{job.id}</Mono> },
              { label: "Target", value: <Mono>{job.baseUrl}</Mono> },
              { label: "Planner", value: job.planner },
              { label: "Attempts", value: job.runs },
              { label: "Project", value: job.project ?? "Unassigned" },
              { label: "Started", value: absoluteTime(job.startedAt) },
              { label: "Elapsed", value: duration(elapsed) },
              {
                label: "Exit code",
                value: job.exitCode === null ? "—" : `${job.exitCode} (${EXIT_MEANING[job.exitCode] ?? "unknown"})`,
              },
              ...(job.error === null ? [] : [{ label: "Error", value: <span className="text-bad">{job.error}</span> }]),
            ]}
          />
          <div className="mt-4 text-xs text-faint">Same run from a terminal:</div>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-code p-2 font-mono text-[11px] text-muted">{terminalCommand(job)}</pre>
        </Panel>
      </div>
    </div>
  );
}
