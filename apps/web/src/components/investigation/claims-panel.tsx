import { ChevronDown, Network } from "lucide-react";
import Link from "next/link";
import type { BugReport, RootCauseReport } from "@exegezis/core";
import { Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";

const STAGE_LABEL: Record<BugReport["evidenceChain"][number]["stage"], { title: string; claim: "declared" | "observed" }> = {
  expectation: { title: "Expected behaviour", claim: "declared" },
  action: { title: "Action", claim: "observed" },
  observation: { title: "Observation", claim: "observed" },
  assertion: { title: "Assertion", claim: "observed" },
  failure: { title: "Failure", claim: "observed" },
  evidence: { title: "Evidence window", claim: "observed" },
};

const FUTURE = [
  { title: "Hypothesis", detail: "A candidate cause, stated with an intervention and a prediction." },
  { title: "Experiment", detail: "The intervention applied to an isolated copy, reproduced against the baseline." },
  { title: "Root cause decision", detail: "VALIDATED only if one hypothesis survives and its alternatives were refuted." },
];

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
  const chain = report?.evidenceChain ?? [];
  const linkFor = (ref: string): string | null => {
    const evt = /^(evt-\d+)/.exec(ref)?.[1];
    if (evt === undefined || attemptRunId === null) return null;
    return `/investigations/${investigationId}?attempt=${attemptRunId}&tab=timeline#${evt}`;
  };

  return (
    <Panel
      id="investigation"
      title="Investigation · Claims"
      icon={<Network />}
      subtitle="What is claimed, and on what basis"
      actions={
        rootCause === null ? (
          <StatusPill status="NOT RUN" tone="q" size="xs" />
        ) : (
          <StatusPill status={`${rootCause.experiments.length} EXPERIMENTS`} tone="ok" size="xs" />
        )
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <ol className="relative flex min-w-0 flex-col">
          {chain.length === 0 && (
            <li className="mb-3 rounded-md border border-line p-3 text-[13px] text-muted">
              No evidence chain: the report has no failing attempt to explain{report === null ? " (no plan was executed)" : ` (${report.outcome.replaceAll("_", " ")})`}.
            </li>
          )}
          {chain.map((link, i) => {
            const meta = STAGE_LABEL[link.stage];
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
                    <span className="text-[13px] font-medium text-fg">{meta.title}</span>
                    <StatusPill status={meta.claim === "declared" ? "DECLARED" : "OBSERVED"} tone={meta.claim === "declared" ? "q" : "ok"} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-xs text-muted">{link.summary}</span>
                    <ChevronDown className="size-3.5 shrink-0 text-faint transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="border-t border-line px-3 py-2 text-[13px]">
                    <div className="text-fg">{link.summary}</div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-faint">
                      ref {link.ref}
                      {href !== null && (
                        <Link href={href} scroll={false} className="text-accent-text hover:underline">
                          open in timeline
                        </Link>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-faint">
                      {meta.claim === "declared" ? "Declared in the plan: the behaviour the symptom says is broken, written as the correct behaviour." : "Recorded by the engine during the attempt."}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
          {rootCause === null
            ? FUTURE.map((node, i) => (
                <li key={node.title} className="relative flex gap-3 pb-3 last:pb-0">
                  {i < FUTURE.length - 1 && <span aria-hidden className="absolute top-7 bottom-0 left-[11px] w-px border-l border-dashed border-line-strong" />}
                  <span className="relative z-10 mt-1 grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-line-strong font-mono text-[10px] text-faint">
                    {chain.length + i + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-2">
                    <span className="text-[13px] font-medium text-muted">{node.title}</span>
                    <StatusPill status="NOT RUN" tone="q" size="xs" />
                    <span className="w-full text-xs text-faint">{node.detail}</span>
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
                          <span className="text-[13px] font-medium text-fg">Hypothesis {e.hypothesisId} → Experiment</span>
                          <StatusPill status="HYPOTHESIS" tone="q" size="xs" />
                          <StatusPill status={e.result.status} tone={EXPERIMENT_TONE[e.result.status]} size="xs" />
                        </div>
                        <span className="text-xs text-muted">{h?.statement}</span>
                        <span className="font-mono text-[11px] text-faint">
                          baseline {e.baseline.reproduced}/{e.baseline.runs} → intervention {e.arm.counts.reproduced}/{e.arm.counts.runs}
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
                      <span className="text-[13px] font-medium text-fg">Root cause decision</span>
                      <StatusPill status={rootCause.decision.status.replaceAll("_", " ")} tone={DECISION_TONE[rootCause.decision.status]} size="xs" />
                    </div>
                    <span className="text-xs text-muted">{rootCause.decision.reason}</span>
                  </div>
                </li>,
              ]}
        </ol>
        <aside className="flex flex-col gap-2 text-xs text-muted">
          <div className="text-[11px] font-medium text-faint">Who may claim what</div>
          <p>
            <span className="text-fg">The model</span> may only propose a plan: an expectation and the steps to test it.
          </p>
          <p>
            <span className="text-fg">The engine</span> records observations and derives the verdict from six deterministic criteria.
          </p>
          <p>
            <span className="text-fg">A cause</span> is claimed only by the deterministic decision over intervention experiments. Nothing may yet claim a fix or that a fix works.
          </p>
        </aside>
      </div>
    </Panel>
  );
}
