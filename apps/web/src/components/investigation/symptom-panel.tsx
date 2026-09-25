import { MessageSquareWarning } from "lucide-react";
import { Meta, Panel } from "@/components/ui/primitives";
import { OutcomePill, StatusPill } from "@/components/ui/status";
import type { InvestigationSummary } from "@/lib/evidence/investigations";

export function SymptomPanel({ summary }: { summary: InvestigationSummary }) {
  const stage = summary.stages.find((s) => s.id === "symptom");
  const source =
    summary.ref.kind === "benchmark-case"
      ? "Benchmark case definition (case.json)"
      : summary.job !== null
        ? "Entered in this UI"
        : summary.generation !== null
          ? "Recorded in the generated plan"
          : null;
  return (
    <Panel id="symptom" title="Symptom" icon={<MessageSquareWarning />} actions={stage !== undefined && <StatusPill status={stage.status} tone={stage.tone} size="xs" />}>
      {summary.symptom === null ? (
        <p className="text-[13px] text-muted">{stage?.detail}</p>
      ) : (
        <blockquote className="whitespace-pre-wrap border-l-2 border-accent/60 pl-4 text-[14px] leading-relaxed text-fg">{summary.symptom}</blockquote>
      )}
      {(source !== null || summary.benchmark !== null) && (
        <Meta
          className="mt-4"
          items={[
            ...(source === null ? [] : [{ label: "Source", value: <span className="text-muted">{source}</span> }]),
            ...(summary.benchmark === null
              ? []
              : [
                  { label: "Case kind", value: summary.benchmark.kind === "positive" ? "Positive (a seeded bug)" : "Negative (must never be VERIFIED)" },
                  { label: "Expected outcome", value: <OutcomePill outcome={summary.benchmark.expected} size="xs" /> },
                  {
                    label: "Benchmark result",
                    value: <StatusPill status={summary.benchmark.passed ? "PASS" : "FAIL"} tone={summary.benchmark.passed ? "positive" : "critical"} size="xs" />,
                  },
                ]),
          ]}
        />
      )}
    </Panel>
  );
}
