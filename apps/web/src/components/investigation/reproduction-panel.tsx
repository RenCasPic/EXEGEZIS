import { Check, Code2, Repeat, X } from "lucide-react";
import Link from "next/link";
import type { BugReport, Reproduction } from "@exegezis/core";
import { CodeBlock, Meta, Mono, Panel, tableClass } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { OutcomePill, StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import type { AttemptEntry, InvestigationSummary } from "@/lib/evidence/investigations";
import { compactJson, duration, percent } from "@/lib/format";

const VERDICT_TONE = { passed: "q", failed: "bad", timeout: "warn", error: "warn", no_assertions: "q" } as const;

export function ReproductionPanel({
  summary,
  report,
  reproduction,
  attempts,
  selectedRunId,
  representativeRunId,
  spec,
  investigationId,
}: {
  summary: InvestigationSummary;
  report: BugReport | null;
  reproduction: Reproduction | null;
  attempts: AttemptEntry[];
  selectedRunId: string | null;
  representativeRunId: string | null;
  spec: { path: string; source: string } | null;
  investigationId: string;
}) {
  const stage = summary.stages.find((s) => s.id === "reproduction");
  const r = report?.reproduction ?? null;
  const compiled = report?.compiledTest ?? null;

  return (
    <Panel
      id="reproduction"
      title="Reproduction"
      icon={<Repeat />}
      actions={
        spec !== null && compiled !== null ? (
          <Sheet trigger={<><Code2 /> Open Playwright Test</>} title="Compiled Playwright test" subtitle={`${spec.path} · sha256 ${compiled.sha256.slice(0, 12)}…`}>
            <div className="flex flex-col gap-4">
              <Meta
                items={[
                  { label: "Runner", value: <Mono>{compiled.runner}</Mono> },
                  {
                    label: "Result",
                    value: <StatusPill status={compiled.status.toUpperCase()} tone={compiled.status === "failed" ? "bad" : compiled.status === "passed" ? "q" : "warn"} size="xs" />,
                  },
                  ...(compiled.failedAtStep === undefined ? [] : [{ label: "Failed at step", value: compiled.failedAtStep }]),
                  ...(compiled.message === undefined ? [] : [{ label: "Message", value: <Mono>{compiled.message}</Mono> }]),
                  { label: "Duration", value: duration(compiled.durationMs) },
                ]}
              />
              <p className="text-xs text-muted">
                Generated from the plan by the compiler and run with the standard Playwright runner, independently of the EXEGEZIS engine. A VERIFIED bug requires
                it to fail at the same step.
              </p>
              <CodeBlock code={spec.source} maxHeight="none" />
            </div>
          </Sheet>
        ) : undefined
      }
    >
      {report === null ? (
        <div className="flex items-center gap-3">
          {stage !== undefined && <StatusPill status={stage.status} tone={stage.tone} />}
          <p className="text-[13px] text-muted">
            {summary.outcomeSource === "benchmark"
              ? `Nothing was executed. The benchmark recorded ${summary.outcome ?? "no outcome"} because ${summary.generation?.status === "declined" ? "the planner declined" : "no valid plan was produced"}.`
              : stage?.detail}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-line bg-panel-2 p-3">
              <div className="text-xs text-muted">Verdict</div>
              <div className="mt-1.5">
                <OutcomePill outcome={report.outcome} />
              </div>
              <div className="mt-2 text-xs text-faint">{report.outcomeReason}</div>
            </div>
            <div className="rounded-md border border-line bg-panel-2 p-3">
              <div className="text-xs text-muted">Runs that failed the expectation</div>
              <div className="mt-1 font-mono text-[22px] font-semibold text-fg">
                {r?.failures ?? 0} <span className="text-faint">/ {r?.attempts ?? 0}</span>
              </div>
              <div className="text-xs text-faint">
                {r?.passes ?? 0} passed · {r?.timeouts ?? 0} timed out · {r?.errors ?? 0} errors
              </div>
            </div>
            <div className="rounded-md border border-line bg-panel-2 p-3">
              <div className="text-xs text-muted">Reproduction rate</div>
              <div className="mt-1 font-mono text-[22px] font-semibold text-fg">{percent(r?.rate ?? null)}</div>
              <div className="text-xs text-faint">
                {r?.status.replace("_", " ")}: {r?.reason}
              </div>
            </div>
          </div>

          {(report.expected !== null || report.actual !== null) && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-line p-3">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted">
                  Expected <span className="font-normal normal-case tracking-normal text-faint">(from the plan)</span>
                </div>
                <div className="text-[13px] text-fg">{report.expected?.description ?? "—"}</div>
                {report.expected !== null && <div className="mt-1.5 font-mono text-[12px] text-ok">{compactJson(report.expected.value)}</div>}
              </div>
              <div className="rounded-md border border-bad/30 bg-bad-bg p-3">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted">
                  Actual <span className="rounded border border-line-strong px-1 text-[10px] tracking-wider text-muted">Observed</span>
                </div>
                <div className="text-[13px] text-fg">{report.actual?.message ?? "—"}</div>
                {report.actual !== null && <div className="mt-1.5 font-mono text-[12px] text-bad">{compactJson(report.actual.value)}</div>}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-medium text-muted">Verification criteria (all six required for VERIFIED)</div>
            <ul className="grid gap-1.5 md:grid-cols-2">
              {report.criteria.map((c) => (
                <li key={c.id} className="flex items-start gap-2 rounded-md border border-line px-3 py-2">
                  {c.met ? <Check className="mt-0.5 size-3.5 shrink-0 text-ok" /> : <X className="mt-0.5 size-3.5 shrink-0 text-bad" />}
                  <div className="min-w-0">
                    <div className="text-[13px] text-fg">{c.description}</div>
                    <div className="break-words text-xs text-faint">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {attempts.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted">Attempts</div>
              <div className={cn(tableClass.wrap, "rounded-md border border-line")}>
                <table className={tableClass.table}>
                  <thead>
                    <tr>
                      <th className={tableClass.th}>#</th>
                      <th className={tableClass.th}>Run</th>
                      <th className={tableClass.th}>Verdict</th>
                      <th className={tableClass.th}>Stopped at</th>
                      <th className={tableClass.th}>Duration</th>
                      <th className={tableClass.th}>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a) => (
                      <tr key={a.runId} className={cn(tableClass.tr, a.runId === selectedRunId && "bg-hover/60")}>
                        <td className={`${tableClass.td} font-mono text-faint`}>{a.attempt}</td>
                        <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>
                          {a.runId}
                          {a.runId === representativeRunId && <span className="ml-2 text-[10px] text-accent-text">cited in report</span>}
                        </td>
                        <td className={tableClass.td}>
                          <StatusPill status={a.verdict.toUpperCase()} tone={VERDICT_TONE[a.verdict as keyof typeof VERDICT_TONE] ?? "q"} size="xs" />
                        </td>
                        <td className={`${tableClass.td} font-mono text-[12px]`}>{a.stoppedAtStep === null ? "—" : `step ${a.stoppedAtStep}`}</td>
                        <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{duration(a.durationMs)}</td>
                        <td className={tableClass.td}>
                          {a.onDisk ? (
                            <Link href={`/investigations/${investigationId}?attempt=${a.runId}#evidence`} scroll={false} className="text-[12px] text-accent-text hover:underline">
                              {a.runId === selectedRunId ? "Viewing" : "View"}
                            </Link>
                          ) : (
                            <span className="text-[12px] text-faint">not on disk</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {reproduction === null && attempts.length === 0 && <p className="text-xs text-faint">reproduction.json is not available for this result (archived results keep only the report).</p>}
        </div>
      )}
    </Panel>
  );
}
