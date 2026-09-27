import { Check, Code2, Repeat, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { BugReport, Reproduction } from "@exegezis/core";
import { EngineText } from "@/components/ui/engine-text";
import { CodeBlock, Meta, Mono, Panel, tableClass } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { OutcomePill, StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import type { AttemptEntry, InvestigationSummary } from "@/lib/evidence/investigations";
import { useFormat } from "@/i18n/client";
import { compactJson } from "@/lib/format";
import { StageDetailText } from "./stage-detail";

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
  const t = useTranslations("investigations.reproduction");
  const crit = useTranslations("investigations.criteria");
  const status = useTranslations("labels.status");
  const f = useFormat();
  const stage = summary.stages.find((s) => s.id === "reproduction");
  const r = report?.reproduction ?? null;
  const compiled = report?.compiledTest ?? null;

  return (
    <Panel
      id="reproduction"
      title={t("title")}
      icon={<Repeat />}
      actions={
        spec !== null && compiled !== null ? (
          <Sheet trigger={<><Code2 /> {t("openTest")}</>} title={t("compiledTitle")} subtitle={`${spec.path} · sha256 ${compiled.sha256.slice(0, 12)}…`}>
            <div className="flex flex-col gap-4">
              <Meta
                items={[
                  { label: t("runner"), value: <Mono>{compiled.runner}</Mono> },
                  {
                    label: t("result"),
                    value: <StatusPill status={compiled.status.toUpperCase()} tone={compiled.status === "failed" ? "bad" : compiled.status === "passed" ? "q" : "warn"} size="xs" />,
                  },
                  ...(compiled.failedAtStep === undefined ? [] : [{ label: t("failedAtStep"), value: compiled.failedAtStep }]),
                  ...(compiled.message === undefined ? [] : [{ label: t("message"), value: <Mono>{compiled.message}</Mono> }]),
                  { label: t("duration"), value: f.duration(compiled.durationMs) },
                ]}
              />
              <p className="text-xs text-muted">{t("compiledNote")}</p>
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
              ? t("nothingExecuted", { outcome: summary.outcome === null ? t("noOutcome") : status(summary.outcome), why: summary.generation?.status === "declined" ? t("plannerDeclined") : t("noValidPlan") })
              : stage !== undefined && <StageDetailText detail={stage.detail} />}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-line bg-panel-2 p-3">
              <div className="text-xs text-muted">{t("verdict")}</div>
              <div className="mt-1.5">
                <OutcomePill outcome={report.outcome} />
              </div>
              <div className="mt-2 text-xs text-faint">
                <EngineText message={report.outcomeMessage} text={report.outcomeReason} />
              </div>
            </div>
            <div className="rounded-md border border-line bg-panel-2 p-3">
              <div className="text-xs text-muted">{t("runsFailed")}</div>
              <div className="mt-1 font-mono text-[22px] font-semibold text-fg">
                {r?.failures ?? 0} <span className="text-faint">/ {r?.attempts ?? 0}</span>
              </div>
              <div className="text-xs text-faint">
                {t("runsBreakdown", { passes: r?.passes ?? 0, timeouts: r?.timeouts ?? 0, errors: r?.errors ?? 0 })}
              </div>
            </div>
            <div className="rounded-md border border-line bg-panel-2 p-3">
              <div className="text-xs text-muted">{t("rate")}</div>
              <div className="mt-1 font-mono text-[22px] font-semibold text-fg">{f.percent(r?.rate ?? null)}</div>
              <div className="text-xs text-faint">
                {r !== null && (
                  <>
                    {status(r.status)}: <EngineText message={r.message} text={r.reason} />
                  </>
                )}
              </div>
            </div>
          </div>

          {(report.expected !== null || report.actual !== null) && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-line p-3">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted">
                  {t("expected")} <span className="font-normal normal-case tracking-normal text-faint">{t("fromPlan")}</span>
                </div>
                <div className="text-[13px] text-fg" translate="no">
                  {report.expected?.description ?? "—"}
                </div>
                {report.expected !== null && <div className="mt-1.5 font-mono text-[12px] text-ok">{compactJson(report.expected.value)}</div>}
              </div>
              <div className="rounded-md border border-bad/30 bg-bad-bg p-3">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted">
                  {t("actual")} <span className="rounded border border-line-strong px-1 text-[10px] tracking-wider text-muted">{t("observed")}</span>
                </div>
                <div className="text-[13px] text-fg">{report.actual === null ? "—" : <EngineText text={report.actual.message} />}</div>
                {report.actual !== null && <div className="mt-1.5 font-mono text-[12px] text-bad">{compactJson(report.actual.value)}</div>}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-medium text-muted">{t("criteriaTitle")}</div>
            <ul className="grid gap-1.5 md:grid-cols-2">
              {report.criteria.map((c) => (
                <li key={c.id} className="flex items-start gap-2 rounded-md border border-line px-3 py-2">
                  {c.met ? <Check className="mt-0.5 size-3.5 shrink-0 text-ok" /> : <X className="mt-0.5 size-3.5 shrink-0 text-bad" />}
                  <div className="min-w-0">
                    <div className="text-[13px] text-fg">{crit(c.id)}</div>
                    <div className="break-words text-xs text-faint">
                      <EngineText message={c.message} text={c.detail} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {attempts.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted">{t("attempts")}</div>
              <div className={cn(tableClass.wrap, "rounded-md border border-line")}>
                <table className={tableClass.table}>
                  <thead>
                    <tr>
                      <th className={tableClass.th}>#</th>
                      <th className={tableClass.th}>{t("colRun")}</th>
                      <th className={tableClass.th}>{t("colVerdict")}</th>
                      <th className={tableClass.th}>{t("colStoppedAt")}</th>
                      <th className={tableClass.th}>{t("colDuration")}</th>
                      <th className={tableClass.th}>{t("colEvidence")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((a) => (
                      <tr key={a.runId} className={cn(tableClass.tr, a.runId === selectedRunId && "bg-hover/60")}>
                        <td className={`${tableClass.td} font-mono text-faint`}>{a.attempt}</td>
                        <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>
                          {a.runId}
                          {a.runId === representativeRunId && <span className="ml-2 text-[10px] text-accent-text">{t("cited")}</span>}
                        </td>
                        <td className={tableClass.td}>
                          <StatusPill status={a.verdict.toUpperCase()} tone={VERDICT_TONE[a.verdict as keyof typeof VERDICT_TONE] ?? "q"} size="xs" />
                        </td>
                        <td className={`${tableClass.td} font-mono text-[12px]`}>{a.stoppedAtStep === null ? "—" : t("step", { step: a.stoppedAtStep })}</td>
                        <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{f.duration(a.durationMs)}</td>
                        <td className={tableClass.td}>
                          {a.onDisk ? (
                            <Link href={`/investigations/${investigationId}?attempt=${a.runId}#evidence`} scroll={false} className="text-[12px] text-accent-text hover:underline">
                              {a.runId === selectedRunId ? t("viewing") : t("view")}
                            </Link>
                          ) : (
                            <span className="text-[12px] text-faint">{t("notOnDisk")}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {reproduction === null && attempts.length === 0 && <p className="text-xs text-faint">{t("noReproductionFile")}</p>}
        </div>
      )}
    </Panel>
  );
}
