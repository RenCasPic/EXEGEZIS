import { Bot } from "lucide-react";
import type { PlanValidation, TestPlan } from "@exegezis/core";
import { CodeBlock, Meta, Mono, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { describeStep } from "@/lib/describe";
import type { GenerationRecord } from "@/lib/evidence/generation";
import type { InvestigationSummary } from "@/lib/evidence/investigations";
import { absoluteTime, duration } from "@/lib/format";

function PlanSteps({ plan, failingStep }: { plan: TestPlan; failingStep: number | null }) {
  return (
    <ol className="divide-y divide-line rounded-md border border-line">
      {plan.steps.map((step, i) => {
        const index = i + 1;
        const purpose = step.type === "assert" ? step.purpose : null;
        return (
          <li key={index} className={cn("flex items-start gap-3 px-3 py-2", index === failingStep && "bg-bad-bg")}>
            <span className="w-6 shrink-0 pt-px font-mono text-[11px] text-faint">{String(index).padStart(2, "0")}</span>
            <span className="w-16 shrink-0 pt-px font-mono text-[11px] text-muted">{step.type}</span>
            <div className="min-w-0 flex-1">
              <div className="break-words font-mono text-[12px] text-fg">{describeStep(step)}</div>
              {step.type === "assert" && step.description !== undefined && <div className="mt-0.5 text-xs text-muted">{step.description}</div>}
            </div>
            {purpose !== null && (
              <span
                className={cn(
                  "shrink-0 rounded border px-1.5 py-px font-mono text-[10px]",
                  purpose === "expectation" ? "border-line-strong text-fg font-medium" : "border-line-strong text-muted",
                )}
              >
                {purpose}
              </span>
            )}
            {index === failingStep && <span className="shrink-0 font-mono text-[10px] text-bad">failed here</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function PlanPanel({
  summary,
  plan,
  generation,
  validation,
  failingStep,
}: {
  summary: InvestigationSummary;
  plan: TestPlan | null;
  generation: GenerationRecord | null;
  validation: PlanValidation | null;
  failingStep: number | null;
}) {
  const stage = summary.stages.find((s) => s.id === "plan");
  const meta = generation?.meta;
  const provenance = plan?.provenance ?? summary.provenance;
  return (
    <Panel
      id="plan"
      title={generation !== null ? "AI Plan" : "Test plan"}
      icon={<Bot />}
      subtitle={plan !== null ? `${plan.id} · ${plan.steps.length} steps` : undefined}
      actions={stage !== undefined && <StatusPill status={stage.status} tone={stage.tone} size="xs" />}
    >
      <div className="flex flex-col gap-4">
        {generation !== null && (
          <div className="rounded-md border border-line bg-panel-2 p-3 text-xs text-muted">
            The model only wrote this plan. It did not see any run, and nothing it wrote is used as evidence: the verdict comes from the deterministic engine.
          </div>
        )}

        {generation?.status === "declined" && (
          <div className="rounded-md border border-warn/40 bg-warn-bg p-3 text-[13px] text-warn">
            <div className="mb-1 font-medium">The planner declined to write a plan</div>
            {generation.reason}
          </div>
        )}
        {(generation?.status === "invalid_generation" || generation?.status === "error") && (
          <div className="rounded-md border border-bad/40 bg-bad-bg p-3 text-[13px] text-bad">
            <div className="mb-1 font-medium">{generation.status === "error" ? `Planner error (${generation.kind ?? "unknown"})` : `Invalid generation (${generation.kind ?? "unknown"})`}</div>
            {generation.message ?? (generation.issues ?? []).join("; ")}
            <div className="mt-1 text-xs opacity-80">Not repaired and not executed.</div>
          </div>
        )}

        <Meta
          items={[
            { label: "Author", value: provenance === null ? "unknown" : provenance.source === "model" ? "Model" : provenance.source === "human" ? "Human" : provenance.source },
            ...(meta === undefined
              ? []
              : [
                  { label: "Provider / model", value: <Mono>{`${meta.provider} / ${meta.model}`}</Mono> },
                  { label: "Prompt version", value: <Mono>{meta.promptVersion}</Mono> },
                  { label: "Latency", value: duration(meta.latencyMs) },
                  { label: "Tokens", value: meta.usage === null ? "—" : <Mono>{`${meta.usage.inputTokens} in / ${meta.usage.outputTokens} out`}</Mono> },
                  { label: "Few-shot examples", value: meta.examples },
                  { label: "Redactions in input", value: meta.redactions },
                ]),
            ...(provenance?.createdAt === null || provenance?.createdAt === undefined ? [] : [{ label: "Written", value: absoluteTime(provenance.createdAt) }]),
            ...(validation === null
              ? []
              : [
                  {
                    label: "Semantic validation",
                    value: (
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          status={validation.status.replace("_", " ").toUpperCase()}
                          tone={validation.status === "valid" ? "ok" : validation.status === "weakly_anchored" ? "warn" : "bad"}
                          size="xs"
                        />
                        {validation.reference !== null && (
                          <span className="text-xs text-muted">
                            {validation.reference.targetsChecked} target(s) checked against the live page, {validation.reference.targetsUnchecked} not checkable before running
                          </span>
                        )}
                      </span>
                    ),
                  },
                ]),
          ]}
        />

        {validation !== null && validation.issues.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-line p-3">
            {validation.issues.map((issue, i) => (
              <li key={i} className="font-mono text-[12px] text-muted">
                <span className={issue.severity === "error" || issue.severity === "unsupported" ? "text-bad" : "text-warn"}>{issue.severity.toUpperCase()}</span> {issue.code}
                {issue.stepIndex === undefined ? "" : ` (step ${issue.stepIndex})`}: {issue.message}
              </li>
            ))}
          </ul>
        )}

        {plan !== null && (
          <div>
            <div className="mb-2 text-[13px] font-medium text-fg">{plan.title}</div>
            {plan.description !== undefined && <p className="mb-3 text-[13px] text-muted">{plan.description}</p>}
            {plan.preconditions.length > 0 && (
              <ul className="mb-3 list-disc pl-5 text-xs text-muted">
                {plan.preconditions.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <PlanSteps plan={plan} failingStep={failingStep} />
          </div>
        )}

        {meta !== undefined && (
          <details className="rounded-md border border-line">
            <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted hover:text-fg">Raw model output (kept for audit)</summary>
            <div className="border-t border-line p-2">
              <CodeBlock code={formatRaw(meta.raw)} maxHeight="24rem" />
            </div>
          </details>
        )}
      </div>
    </Panel>
  );
}

function formatRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
