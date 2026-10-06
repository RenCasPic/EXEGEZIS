import { ArrowRight, TerminalSquare } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { AccessDoneButton, BlockNotice } from "@/components/access/block-notice";
import { EngineProblem } from "@/components/ui/copy-command";
import { accessEntry } from "@/lib/access";
import { BROWSER_REMEDY } from "@/lib/browser-check";
import { ButtonLink, CodeBlock, Meta, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { getFormat } from "@/i18n/server";
import { inspectionJobState } from "@/lib/inspection-state";
import { listInspections } from "@/lib/evidence/inspections";
import { getSummaries } from "@/lib/evidence/investigations";
import { listSearches } from "@/lib/evidence/searches";
import { jobPercent } from "@/lib/progress";
import { EXIT_CODES, jobLog, jobProgress, readJob, type AccessJob, type InspectJob, type InspectionProgressFile, type JobStatus, type SearchJob } from "@/lib/jobs";
import { SEARCH_STATUS_TONE } from "@/lib/search-labels";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("jobs"))("metaTitle") };
}

const PHASES = ["robots", "crawl", "repeat", "specs", "search", "ai", "done"] as const;

/** "4 (inconclusive …)" in the reader's language. */
function exitText(t: (key: never) => string, code: number | null): string {
  if (code === null) return "—";
  return `${code} (${(EXIT_CODES as readonly number[]).includes(code) ? t(`exit.${code}` as never) : t("exit.unknown" as never)})`;
}

function Progress({ progress }: { progress: InspectionProgressFile | null }) {
  const t = useTranslations("jobs");
  const tc = useTranslations("common");
  if (progress === null) return <p className="text-[13px] text-muted">{t("progress.waiting")}</p>;
  const pct = jobPercent(progress);
  const phase = (PHASES as readonly string[]).includes(progress.phase) ? t(`phase.${progress.phase as (typeof PHASES)[number]}`) : progress.phase;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
        <span className="font-medium text-fg">
          {phase}
          {pct !== null && <span className="ml-2 font-mono text-xs text-muted">{pct} %</span>}
        </span>
        <span className="font-mono text-xs text-muted">
          {progress.device !== undefined && (progress.devices ?? 1) > 1 && <span className="mr-1.5 font-sans font-medium text-fg">{tc(`device.${progress.device}`)} ·</span>}
          {t("progress.counts", { run: progress.run, runs: progress.runs, done: progress.pagesDone, planned: progress.pagesPlanned })}
        </span>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(pct === null ? {} : { "aria-valuenow": pct })}
        aria-label={t("progress.label")}
      >
        {pct === null ? (
          <div className="animate-progress-slide absolute inset-y-0 w-1/3 rounded-full bg-accent" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out" style={{ width: `${Math.max(pct, 2)}%` }} />
        )}
      </div>
      {progress.current !== null && (
        <div className="truncate font-mono text-[11px] text-faint" title={progress.current}>
          {progress.current}
        </div>
      )}
    </div>
  );
}

function Output({ log, status, maxHeight, subtitle }: { log: string | null; status: JobStatus; maxHeight: string; subtitle: string }) {
  const t = useTranslations("jobs");
  return (
    <Panel title={t("output")} icon={<TerminalSquare />} subtitle={subtitle} bodyClassName="p-0">
      {log === null || log.trim() === "" ? (
        <div className="p-4 text-[13px] text-muted">{status === "queued" ? t("queuedNoOutput") : t("noOutput")}</div>
      ) : (
        <CodeBlock code={log} lineNumbers={false} className="rounded-none border-0" maxHeight={maxHeight} />
      )}
    </Panel>
  );
}

function JobError({ error }: { error: string }) {
  return (
    <span className="text-bad" translate="no">
      {error}
    </span>
  );
}

function AccessJobView({ job, status, log }: { job: AccessJob; status: JobStatus; log: string | null }) {
  const t = useTranslations("jobs");
  const running = status === "running";
  const saved = status === "finished" && job.exitCode === 0;
  const notSaved = status === "finished" && job.exitCode !== 0;
  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={running || (saved && job.relaunch !== null && job.relaunchedJobId === null)} />
      <PageHeader
        eyebrow={<StatusPill status={running ? "WINDOW_OPEN" : saved ? "ACCESS_SAVED" : status === "lost" ? "LOST" : "NOT_SAVED"} tone={running ? "running" : saved ? "ok" : "bad"} />}
        title={<span className="break-all font-mono text-[20px]">{job.url}</span>}
        description={running ? t("access.opened") : saved ? t("access.saved") : notSaved ? t("access.notSaved") : undefined}
        actions={
          saved && job.relaunchedJobId !== null ? (
            <ButtonLink href={`/jobs/${job.relaunchedJobId}`} variant="primary">
              {t("access.viewNew")} <ArrowRight />
            </ButtonLink>
          ) : undefined
        }
      />
      {running && (
        <Panel title={t("access.whatNow")}>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-fg">
            <li>{t("access.step1")}</li>
            <li>
              {job.block === "CONSENT_WALL" ? t("access.stepConsent") : job.block === "BOT_CHALLENGE" ? t("access.stepChallenge") : t("access.stepLogin")} {t("access.noTyping")}
            </li>
            <li>{t("access.step3")}</li>
          </ol>
          <div className="mt-4">
            <AccessDoneButton jobId={job.id} />
          </div>
        </Panel>
      )}
      <Output log={log} status={status} maxHeight="24rem" subtitle={t("outputNoSecrets")} />
    </div>
  );
}

async function SearchJobView({ job, status, log }: { job: SearchJob; status: JobStatus; log: string | null }) {
  const [progress, searches, t, f] = await Promise.all([jobProgress(job.id, "searches"), listSearches(), getTranslations("jobs"), getFormat()]);
  const search = searches.find((s) => s.jobId === job.id) ?? null;
  const report = search?.report.status === "ok" ? search.report.value : null;
  const active = status === "running" || status === "queued";
  const elapsed = (job.finishedAt === null ? Date.now() : Date.parse(job.finishedAt)) - Date.parse(job.startedAt);
  const what =
    job.saved !== null
      ? t("search.saved")
      : job.mode === "meaning"
        ? t("search.meaning", { text: job.meaning ?? "" })
        : job.mode === "template"
          ? t("search.template", { id: job.template ?? "" })
          : t("search.exact", { terms: job.terms ?? "" });
  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={active} />
      <PageHeader
        eyebrow={
          report !== null ? (
            <StatusPill status={report.status} tone={SEARCH_STATUS_TONE[report.status]} />
          ) : (
            <StatusPill status={status === "queued" ? "QUEUED" : status === "running" ? "SEARCHING" : status === "lost" ? "LOST" : "NO_REPORT"} tone={active ? "running" : "bad"} />
          )
        }
        title={<span className="break-all font-mono text-[20px]">{job.url}</span>}
        description={
          <>
            <span className="block">{t("search.heading", { what })}</span>
            {status === "queued"
              ? t("search.queued")
              : status === "running"
                ? t("search.running")
                : status === "lost"
                  ? t("search.lost")
                  : report === null
                    ? t("search.noReport")
                    : t("search.summary", { hits: report.summary.hits, searched: report.coverage.searched, found: report.coverage.found })}
          </>
        }
        actions={
          search !== null ? (
            <ButtonLink href={`/searches/${search.id}`} variant="primary">
              {t("search.viewResults")} <ArrowRight />
            </ButtonLink>
          ) : undefined
        }
      />
      {job.exitCode === 7 && <EngineProblem message={t("search.noBrowser")} remedy={BROWSER_REMEDY} />}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {active && (
            <Panel title={t("progressTitle")} subtitle="progress.json">
              <Progress progress={progress} />
            </Panel>
          )}
          <Output log={log} status={status} maxHeight="36rem" subtitle="output.log" />
        </div>
        <Panel title={t("search.title")}>
          <Meta
            items={[
              { label: t("job"), value: <Mono>{job.id}</Mono> },
              { label: t("started"), value: f.absolute(job.startedAt) },
              { label: t("elapsed"), value: f.duration(elapsed) },
              { label: t("exitCode"), value: exitText(t, job.exitCode) },
              ...(job.error === null ? [] : [{ label: t("error"), value: <JobError error={job.error} /> }]),
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

async function InspectJobView({ job, status, log }: { job: InspectJob; status: JobStatus; log: string | null }) {
  const [progress, inspections, t, tc, f] = await Promise.all([jobProgress(job.id), listInspections(), getTranslations("jobs"), getTranslations("common"), getFormat()]);
  const inspection = inspections.find((i) => i.jobId === job.id) ?? null;
  const report = inspection?.report.status === "ok" ? inspection.report.value : null;
  const state = inspectionJobState(status, job.exitCode, report?.status ?? null);
  const entryBlock = report?.pages.find((p) => p.depth === 0 && p.run === 1)?.block ?? null;
  const access = report === null ? null : await accessEntry(report.target.origin);
  const active = status === "running" || status === "queued";
  const elapsed = (job.finishedAt === null ? Date.now() : Date.parse(job.finishedAt)) - Date.parse(job.startedAt);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={active} />
      <PageHeader
        eyebrow={<StatusPill status={state.label} tone={state.tone} />}
        title={<span className="break-all font-mono text-[20px]">{job.url}</span>}
        description={
          status === "queued"
            ? t("inspect.queued")
            : status === "running"
              ? t("inspect.running")
              : status === "lost"
                ? t("inspect.lost")
                : state.label === "BLOCKED"
                  ? t("inspect.blocked")
                  : state.label === "ENGINE_ERROR"
                    ? t("inspect.engineError")
                    : undefined
        }
        actions={
          inspection !== null ? (
            <ButtonLink href={`/inspections/${inspection.id}`} variant="primary">
              {t("inspect.openReport")} <ArrowRight />
            </ButtonLink>
          ) : undefined
        }
      />
      {entryBlock !== null && report !== null && (
        <BlockNotice block={entryBlock} origin={report.target.origin} inspectionId={inspection?.id ?? null} relaunchJobId={job.id} hasWafToken={access?.kinds.includes("wafToken") === true} />
      )}
      {state.label === "ENGINE_ERROR" && (
        <EngineProblem
          message={t("inspect.noBrowser")}
          remedy={report?.engineError?.remedy ?? BROWSER_REMEDY}
          detail={report?.engineError === undefined || report.engineError === null ? [] : [report.engineError.message, ...report.engineError.attempts.map((a) => `${a.engine}: ${a.error}`)]}
        />
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {active && (
            <Panel title={t("progressTitle")} subtitle="progress.json">
              <Progress progress={progress} />
            </Panel>
          )}
          <Output log={log} status={status} maxHeight="36rem" subtitle="output.log" />
        </div>
        <Panel title={t("inspect.title")}>
          <Meta
            items={[
              { label: t("job"), value: <Mono>{job.id}</Mono> },
              { label: t("inspect.runs"), value: job.runs },
              { label: t("inspect.devices"), value: job.devices.map((d) => tc(`device.${d}`)).join(", ") },
              { label: t("inspect.pages"), value: job.maxPages ?? t("inspect.pagesDefault") },
              { label: t("inspect.depth"), value: job.maxDepth ?? t("inspect.depthDefault") },
              { label: t("inspect.checks"), value: job.checks?.join(", ") ?? t("inspect.allChecks") },
              { label: t("inspect.mode"), value: job.strictReadonly ? t("inspect.strict") : t("inspect.readonly") },
              { label: t("inspect.robots"), value: job.ignoreRobots ? t("inspect.ignored") : t("inspect.respected") },
              { label: t("inspect.browser"), value: job.browserChannel === "auto" ? t("inspect.automatic") : job.browserChannel },
              { label: t("inspect.session"), value: job.storageState === null ? t("inspect.none") : t("inspect.storageState") },
              { label: t("started"), value: f.absolute(job.startedAt) },
              { label: t("elapsed"), value: f.duration(elapsed) },
              { label: t("exitCode"), value: exitText(t, job.exitCode) },
              ...(job.error === null ? [] : [{ label: t("error"), value: <JobError error={job.error} /> }]),
            ]}
          />
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
  if (job.kind === "access") return <AccessJobView job={job} status={status} log={log} />;
  if (job.kind === "search") return <SearchJobView job={job} status={status} log={log} />;

  const [summaries, t, f] = await Promise.all([getSummaries(), getTranslations("jobs"), getFormat()]);
  const investigation = summaries.find((s) => s.ref.jobId === id) ?? null;
  const tone = status === "running" ? "running" : status === "finished" ? (job.exitCode === 0 ? "ok" : "q") : "bad";
  const elapsed = (job.finishedAt === null ? Date.now() : Date.parse(job.finishedAt)) - Date.parse(job.startedAt);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={status === "running"} />
      <PageHeader
        eyebrow={<StatusPill status={status.toUpperCase()} tone={tone} />}
        title={<span translate="no">{job.symptom.split("\n")[0] ?? job.symptom}</span>}
        description={status === "running" ? t("investigation.running") : status === "lost" ? t("investigation.lost") : undefined}
        actions={
          investigation !== null ? (
            <ButtonLink href={`/investigations/${investigation.ref.id}`} variant="primary">
              {t("investigation.open")} <ArrowRight />
            </ButtonLink>
          ) : undefined
        }
      />
      {job.exitCode === 7 && <EngineProblem message={t("investigation.noBrowser")} remedy={BROWSER_REMEDY} />}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Output log={log} status={status} maxHeight="36rem" subtitle="output.log" />
        <Panel title={t("investigation.run")}>
          <Meta
            items={[
              { label: t("job"), value: <Mono>{job.id}</Mono> },
              { label: t("investigation.target"), value: <Mono>{job.baseUrl}</Mono> },
              { label: t("investigation.planner"), value: job.planner },
              { label: t("investigation.attempts"), value: job.runs },
              { label: t("investigation.project"), value: job.project ?? t("investigation.unassigned") },
              { label: t("started"), value: f.absolute(job.startedAt) },
              { label: t("elapsed"), value: f.duration(elapsed) },
              { label: t("exitCode"), value: exitText(t, job.exitCode) },
              ...(job.error === null ? [] : [{ label: t("error"), value: <JobError error={job.error} /> }]),
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
