import { AlertTriangle, ArrowLeft, FileJson } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimsPanel } from "@/components/investigation/claims-panel";
import { EVIDENCE_TABS, EvidencePanel, type EvidenceTab } from "@/components/investigation/evidence-panel";
import { FixPanel, RootCausePanel, VerificationPanel } from "@/components/investigation/future-panels";
import { InvestigationPipeline } from "@/components/investigation/investigation-pipeline";
import { PlanPanel } from "@/components/investigation/plan-panel";
import { ReproductionPanel } from "@/components/investigation/reproduction-panel";
import { SymptomPanel } from "@/components/investigation/symptom-panel";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { Meta, Mono, Panel } from "@/components/ui/primitives";
import { OutcomePill, SourceTag, StatusPill } from "@/components/ui/status";
import { loadAttempt } from "@/lib/evidence/attempt";
import { getRootCauses, loadInvestigation } from "@/lib/evidence/investigations";
import { absoluteTime, relativeTime } from "@/lib/format";
import { environmentOf } from "@/lib/projects";
import { artifactUrl } from "@/lib/urls";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = await loadInvestigation(id);
  return { title: detail?.summary.title ?? "Investigation" };
}

export default async function InvestigationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const detail = await loadInvestigation(id);
  if (detail === null) notFound();
  const { summary, report, attempts } = detail;

  const wanted = typeof query.attempt === "string" ? query.attempt : null;
  const selected =
    attempts.find((a) => a.onDisk && a.runId === wanted) ??
    attempts.find((a) => a.onDisk && a.runId === detail.representativeRunId) ??
    attempts.find((a) => a.onDisk) ??
    null;
  const evidence = selected === null ? null : await loadAttempt(summary.ref, selected.runPath);
  const rootCause = summary.rootCause === null ? null : ((await getRootCauses()).find((e) => e.ref.id === summary.rootCause?.entryId) ?? null);
  const rootCauseReport = rootCause?.report.status === "ok" ? rootCause.report.value : null;
  const tab: EvidenceTab = EVIDENCE_TABS.includes(query.tab as EvidenceTab) ? (query.tab as EvidenceTab) : "timeline";

  const title = summary.outcome === "VERIFIED" ? "Verified Bug" : null;

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh active={summary.job?.status === "running" && summary.outcome === null} />
      <div className="flex flex-col gap-3 border-b border-line pb-5">
        <Link href="/investigations" className="flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
          <ArrowLeft className="size-3" /> Investigations
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <OutcomePill outcome={summary.outcome} />
          {title !== null && <span className="text-[13px] font-medium text-positive">{title}</span>}
          {summary.outcomeSource === "benchmark" && <span className="text-xs text-faint">(benchmark record: no plan was executed)</span>}
          <SourceTag kind={summary.ref.archived ? "archived" : "real"} />
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">{summary.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-muted">
          <span className="text-fg">{summary.ref.caseId ?? summary.planId ?? summary.ref.id}</span>
          <span className="text-faint">·</span>
          <span>{summary.project ?? "Unassigned"}</span>
          <span className="text-faint">·</span>
          <span>{environmentOf(summary.target) ?? "unknown environment"}</span>
          <span className="text-faint">·</span>
          <span title={absoluteTime(summary.createdAt)}>Created {relativeTime(summary.createdAt)}</span>
          {summary.provenance?.source === "model" && (
            <>
              <span className="text-faint">·</span>
              <span>
                plan by {summary.provenance.model ?? summary.provenance.generator} ({summary.provenance.promptVersion})
              </span>
            </>
          )}
          {summary.ref.benchmarkId !== null && (
            <>
              <span className="text-faint">·</span>
              <Link href={`/benchmarks/${summary.ref.benchmarkId}`} className="text-accent hover:underline">
                benchmark run
              </Link>
            </>
          )}
          {summary.job !== null && (
            <>
              <span className="text-faint">·</span>
              <Link href={`/jobs/${summary.job.id}`} className="text-accent hover:underline">
                CLI output
              </Link>
            </>
          )}
        </div>
      </div>

      {detail.problems.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-critical/40 bg-critical/10 p-3 text-[13px] text-critical">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            Some artifacts failed schema validation and are not shown:
            <ul className="mt-1 list-disc pl-5 font-mono text-[12px]">
              {detail.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <InvestigationPipeline stages={summary.stages} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-5">
          <SymptomPanel summary={summary} />
          <PlanPanel summary={summary} plan={detail.plan} generation={detail.generation} validation={detail.validation} failingStep={report?.failingStep?.index ?? null} />
          <ReproductionPanel
            summary={summary}
            report={report}
            reproduction={detail.reproduction}
            attempts={attempts}
            selectedRunId={selected?.runId ?? null}
            representativeRunId={detail.representativeRunId}
            spec={detail.spec}
            investigationId={id}
          />
          <EvidencePanel summary={summary} report={report} attempts={attempts} evidence={evidence} tab={tab} investigationId={id} />
          <ClaimsPanel report={report} rootCause={rootCauseReport} investigationId={id} attemptRunId={detail.representativeRunId} />
          <RootCausePanel entry={rootCause} bugId={summary.ref.caseId ?? report?.bugId ?? null} />
          <FixPanel spec={detail.spec} />
          <VerificationPanel report={report} />
        </div>

        <aside className="flex flex-col gap-5 xl:sticky xl:top-18 xl:self-start">
          <Panel title="Report" icon={<FileJson />}>
            {report === null ? (
              <p className="text-[13px] text-muted">No BugReport: the plan was not executed.</p>
            ) : (
              <Meta
                className="text-[12px]"
                items={[
                  { label: "Bug id", value: <Mono>{report.bugId}</Mono> },
                  { label: "Outcome", value: <OutcomePill outcome={report.outcome} size="xs" /> },
                  { label: "Failing step", value: report.failingStep === null ? "—" : `${report.failingStep.index}${report.failingStep.id === undefined ? "" : ` (${report.failingStep.id})`}` },
                  { label: "Min. attempts", value: report.policy.minAttempts },
                  { label: "Strong anchors", value: report.policy.requireStrongAnchoring ? "required" : "not required" },
                  { label: "Plan hash", value: <Mono className="break-all text-[11px]">{report.plan.hash.replace("sha256:", "").slice(0, 16)}…</Mono> },
                  { label: "Browser", value: report.environment?.browser === undefined ? "—" : `${report.environment.browser.name} ${report.environment.browser.version}` },
                  { label: "Engine", value: `exegezis ${report.exegezisVersion}` },
                  { label: "Generated", value: absoluteTime(report.generatedAt) },
                ]}
              />
            )}
          </Panel>
          <Panel title="Files">
            <ul className="flex flex-col gap-1 font-mono text-[12px]">
              {detail.files.map((f) => (
                <li key={f}>
                  <a href={artifactUrl(id, f)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {f}
                  </a>
                </li>
              ))}
              {detail.spec !== null && (
                <li>
                  <a href={artifactUrl(id, detail.spec.path)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {detail.spec.path}
                  </a>
                </li>
              )}
            </ul>
            <p className="mt-3 break-all font-mono text-[11px] text-faint">{summary.ref.relDir}</p>
          </Panel>
          <Panel title="Stages">
            <ul className="flex flex-col gap-2">
              {summary.stages.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-muted">{s.label}</span>
                  <StatusPill status={s.status} tone={s.tone} size="xs" />
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
