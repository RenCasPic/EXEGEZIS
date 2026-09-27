import { ChevronDown, Network } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { BugReport, RootCauseReport } from "@exegezis/core";
import { Panel } from "@/components/ui/primitives";
import { EngineText } from "@/components/ui/engine-text";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";

const CLAIM: Record<BugReport["evidenceChain"][number]["stage"], "declared" | "observed"> = {
  expectation: "declared",
  action: "observed",
  observation: "observed",
  assertion: "observed",
  failure: "observed",
  evidence: "observed",
};

const FUTURE = ["hypothesis", "experiment", "decision"] as const;

const EXPERIMENT_TONE = { CONFIRMED: "ok", FALSIFIED: "off", INCONCLUSIVE: "q" } as const;
const DECISION_TONE = { VALIDATED: "ok", REFUTED: "off", INSUFFICIENT_EVIDENCE: "q" } as const;

/**
 * The claims EXEGEZIS makes today are the BugReport's evidence chain: one
 * declared expectation and what the engine observed. Anything beyond that
 * (hypotheses, experiments, causes) is not produced yet, and is drawn as such.
 */
export function ClaimsPanel({
  report,
  rootCause,
  investigationId,
  attemptRunId,
}: {
  report: BugReport | null;
  rootCause: RootCauseReport | null;
  investigationId: string;
  attemptRunId: string | null;
}) {
  const t = useTranslations("investigations.claims");
  const status = useTranslations("labels.status");
  const chain = report?.evidenceChain ?? [];
  const linkFor = (ref: string): string | null => {
    const evt = /^(evt-\d+)/.exec(ref)?.[1];
    if (evt === undefined || attemptRunId === null) return null;
    return `/investigations/${investigationId}?attempt=${attemptRunId}&tab=timeline#${evt}`;
  };

  return (
    <Panel
      id="investigation"
      title={t("title")}
      icon={<Network />}
      subtitle={t("subtitle")}
      actions={
        rootCause === null ? (
          <StatusPill status="NOT_RUN" tone="q" size="xs" />
        ) : (
          <StatusPill status="EXPERIMENTS" tone="ok" size="xs" />
        )
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <ol className="relative flex min-w-0 flex-col">
          {chain.length === 0 && (
            <li className="mb-3 rounded-md border border-line p-3 text-[13px] text-muted">
              {report === null ? t("noChain") : t("noChainOutcome", { outcome: status(report.outcome) })}
            </li>
          )}
          {chain.map((link, i) => {
            const claim = CLAIM[link.stage];
            const href = linkFor(link.ref);
            return (
              <li key={`${link.stage}-${i}`} className="relative flex gap-3 pb-3">
                <span aria-hidden className="absolute top-7 bottom-0 left-[11px] w-px bg-line-strong" />
                <span
                  className={cn(
                    "relative z-10 mt-1 grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[10px]",
                    link.stage === "failure" ? "border-bad/60 bg-bad-bg text-bad" : "border-line-strong bg-panel-2 text-muted",
                  )}
                >
                  {i + 1}
                </span>
                <details className="group min-w-0 flex-1 rounded-md border border-line bg-panel-2" open={link.stage === "failure"}>
                  <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
                    <span className="text-[13px] font-medium text-fg">{t(`stage.${link.stage}`)}</span>
                    <StatusPill status={claim === "declared" ? "DECLARED" : "OBSERVED"} tone={claim === "declared" ? "q" : "ok"} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">
                      {link.stage === "expectation" || link.stage === "observation" ? <span translate="no">{link.summary}</span> : <EngineText message={link.message} text={link.summary} />}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 text-faint transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-line px-3 py-2 text-[13px]">
                    <div className="text-fg">
                      {link.stage === "expectation" || link.stage === "observation" ? <span translate="no">{link.summary}</span> : <EngineText message={link.message} text={link.summary} />}
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-faint">
                      {t("ref", { ref: link.ref })}
                      {href !== null && (
                        <Link href={href} scroll={false} className="text-accent-text hover:underline">
                          {t("openTimeline")}
                        </Link>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-faint">
                      {claim === "declared" ? t("declaredNote") : t("observedNote")}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
          {rootCause === null
            ? FUTURE.map((node, i) => (
                <li key={node} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < FUTURE.length - 1 && <span aria-hidden className="absolute top-7 bottom-0 left-[11px] w-px border-l border-dashed border-line-strong" />}
                  <span className="relative z-10 mt-1 grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-line-strong font-mono text-[10px] text-faint">
                    {chain.length + i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2">
                    <span className="text-[13px] font-medium text-muted">{t(`future.${node}`)}</span>
                    <StatusPill status="NOT_RUN" tone="q" size="xs" />
                    <span className="w-full text-xs text-faint">{t(`future.${node}Detail`)}</span>
                  </div>
                </li>
              ))
            : [
                ...rootCause.experiments.map((e, i) => {
                  const h = rootCause.hypotheses.find((x) => x.id === e.hypothesisId);
                  return (
                    <li key={e.id} className="relative flex gap-3 pb-3">
                      <span aria-hidden className="absolute top-7 bottom-0 left-[11px] w-px bg-line-strong" />
                      <span className="relative z-10 mt-1 grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-panel-2 font-mono text-[10px] text-muted">
                        {chain.length + i + 1}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-md border border-line bg-panel-2 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-fg">{t("hypothesisExperiment", { id: e.hypothesisId })}</span>
                          <StatusPill status="HYPOTHESIS" tone="q" size="xs" />
                          <StatusPill status={e.result.status} tone={EXPERIMENT_TONE[e.result.status]} size="xs" />
                        </div>
                        <span className="text-xs text-muted" translate="no">
                          {h?.statement}
                        </span>
                        <span className="font-mono text-[11px] text-faint">
                          {t("counts", { baseline: e.baseline.reproduced, runs: e.baseline.runs, arm: e.arm.counts.reproduced, armRuns: e.arm.counts.runs })}
                        </span>
                      </div>
                    </li>
                  );
                }),
                <li key="decision" className="relative flex gap-3">
                  <span className="relative z-10 mt-1 grid size-6 shrink-0 place-items-center rounded-full border border-line-strong bg-panel-2 font-mono text-[10px] text-muted">
                    {chain.length + rootCause.experiments.length + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-md border border-line bg-panel-2 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-fg">{t("future.decision")}</span>
                      <StatusPill status={rootCause.decision.status} tone={DECISION_TONE[rootCause.decision.status]} size="xs" />
                    </div>
                    <span className="text-xs text-muted">
                      <EngineText message={rootCause.decision.message} text={rootCause.decision.reason} />
                    </span>
                  </div>
                </li>,
              ]}
        </ol>
        <aside className="flex flex-col gap-2 text-xs text-muted">
          <div className="text-[11px] font-medium text-faint">{t("who")}</div>
          <p>{t("whoModel")}</p>
          <p>{t("whoEngine")}</p>
          <p>{t("whoCause")}</p>
        </aside>
      </div>
    </Panel>
  );
}
