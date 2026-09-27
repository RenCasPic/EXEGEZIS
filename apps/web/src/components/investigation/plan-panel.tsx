import { Bot } from "lucide-react";
import { stepMessage, type PlanValidation, type TestPlan } from "@exegezis/core";
import { useTranslations } from "next-intl";
import { CodeBlock, Meta, Mono, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { EngineText, translateEngine } from "@/components/ui/engine-text";
import type { GenerationRecord } from "@/lib/evidence/generation";
import type { InvestigationSummary } from "@/lib/evidence/investigations";
import { useFormat } from "@/i18n/client";

function PlanSteps({ plan, failingStep }: { plan: TestPlan; failingStep: number | null }) {
  const t = useTranslations("investigations.plan");
  const engine = useTranslations("engine");
  const labels = useTranslations("labels");
  return (
    <ol className="divide-y divide-line rounded-md border border-line">
      {plan.steps.map((step, i) => {
        const index = i + 1;
        const purpose = step.type === "assert" ? step.purpose : null;
        return (
          <li key={index} className={cn("flex items-start gap-3 px-3 py-2", index === failingStep && "bg-bad-bg")}>
            <span className="w-6 shrink-0 pt-px font-mono text-[11px] text-faint">{String(index).padStart(2, "0")}</span>
            <span className="w-16 shrink-0 pt-px font-mono text-[11px] text-muted" title={step.type}>
              {t(`stepType.${step.type}`)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="break-words font-mono text-[12px] text-fg">{translateEngine(engine, labels, stepMessage(step))}</div>
              {step.type === "assert" && step.description !== undefined && (
                <div className="mt-0.5 text-xs text-muted" translate="no">
                  {step.description}
                </div>
              )}
            </div>
            {purpose !== null && (
              <span
                className={cn(
                  "shrink-0 rounded border px-1.5 py-px font-mono text-[10px]",
                  purpose === "expectation" ? "border-line-strong text-fg font-medium" : "border-line-strong text-muted",
                )}
              >
                {t(`purpose.${purpose}`)}
              </span>
            )}
            {index === failingStep && <span className="shrink-0 font-mono text-[10px] text-bad">{t("failedHere")}</span>}
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
  const t = useTranslations("investigations.plan");
  const severity = useTranslations("labels.severityIssue");
  const f = useFormat();
  const stage = summary.stages.find((s) => s.id === "plan");
  const meta = generation?.meta;
  const provenance = plan?.provenance ?? summary.provenance;
  return (
    <Panel
      id="plan"
      title={generation !== null ? t("aiPlan") : t("testPlan")}
      icon={<Bot />}
      subtitle={plan !== null ? t("subtitle", { id: plan.id, count: plan.steps.length }) : undefined}
      actions={stage !== undefined && <StatusPill status={stage.status} tone={stage.tone} size="xs" />}
    >
      <div className="flex flex-col gap-4">
        {generation !== null && (
          <div className="rounded-md border border-line bg-panel-2 p-3 text-xs text-muted">
            {t("modelOnly")}
          </div>
        )}

        {generation?.status === "declined" && (
          <div className="rounded-md border border-warn/40 bg-warn-bg p-3 text-[13px] text-warn">
            <div className="mb-1 font-medium">{t("declined")}</div>
            <span translate="no">{generation.reason}</span>
          </div>
        )}
        {(generation?.status === "invalid_generation" || generation?.status === "error") && (
          <div className="rounded-md border border-bad/40 bg-bad-bg p-3 text-[13px] text-bad">
            <div className="mb-1 font-medium">{generation.status === "error" ? t("plannerError", { kind: generation.kind ?? t("unknownKind") }) : t("invalidGeneration", { kind: generation.kind ?? t("unknownKind") })}</div>
            <EngineText text={generation.message ?? (generation.issues ?? []).join("; ")} />
            <div className="mt-1 text-xs opacity-80">{t("notRepaired")}</div>
          </div>
        )}

        <Meta
          items={[
            { label: t("author"), value: provenance === null ? t("authorUnknown") : provenance.source === "model" ? t("authorModel") : provenance.source === "human" ? t("authorHuman") : provenance.source === "tool" ? t("authorTool") : t("authorUnknown") },
            ...(meta === undefined
              ? []
              : [
                  { label: t("providerModel"), value: <Mono>{`${meta.provider} / ${meta.model}`}</Mono> },
                  { label: t("promptVersion"), value: <Mono>{meta.promptVersion}</Mono> },
                  { label: t("latency"), value: f.duration(meta.latencyMs) },
                  { label: t("tokens"), value: meta.usage === null ? "—" : <Mono>{t("tokensValue", { input: meta.usage.inputTokens, output: meta.usage.outputTokens })}</Mono> },
                  { label: t("examples"), value: meta.examples },
                  { label: t("redactions"), value: meta.redactions },
                ]),
            ...(provenance?.createdAt === null || provenance?.createdAt === undefined ? [] : [{ label: t("written"), value: f.absolute(provenance.createdAt) }]),
            ...(validation === null
              ? []
              : [
                  {
                    label: t("validation"),
                    value: (
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          status={validation.status.toUpperCase()}
                          tone={validation.status === "valid" ? "ok" : validation.status === "weakly_anchored" ? "warn" : "bad"}
                          size="xs"
                        />
                        {validation.reference !== null && (
                          <span className="text-xs text-muted">
                            {t("targetsChecked", { checked: validation.reference.targetsChecked, unchecked: validation.reference.targetsUnchecked })}
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
                <span className={issue.severity === "error" || issue.severity === "unsupported" ? "text-bad" : "text-warn"}>{severity(issue.severity)}</span> {issue.code}
                {issue.stepIndex === undefined ? "" : ` ${t("issueStep", { step: issue.stepIndex })}`}: <EngineText message={issue.detail} text={issue.message} />
              </li>
            ))}
          </ul>
        )}

        {plan !== null && (
          <div>
            <div className="mb-2 text-[13px] font-medium text-fg" translate="no">
              {plan.title}
            </div>
            {plan.description !== undefined && (
              <p className="mb-3 text-[13px] text-muted" translate="no">
                {plan.description}
              </p>
            )}
            {plan.preconditions.length > 0 && (
              <ul className="mb-3 list-disc pl-5 text-xs text-muted" translate="no">
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
            <summary className="cursor-pointer px-3 py-2 text-[13px] text-muted hover:text-fg">{t("rawOutput")}</summary>
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
