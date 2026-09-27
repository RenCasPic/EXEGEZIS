import { MessageSquareWarning } from "lucide-react";
import { useTranslations } from "next-intl";
import { Meta, Panel } from "@/components/ui/primitives";
import { OutcomePill, StatusPill } from "@/components/ui/status";
import type { InvestigationSummary } from "@/lib/evidence/investigations";
import { StageDetailText } from "./stage-detail";

export function SymptomPanel({ summary }: { summary: InvestigationSummary }) {
  const t = useTranslations("investigations.symptom");
  const stage = summary.stages.find((s) => s.id === "symptom");
  const source = summary.ref.kind === "benchmark-case" ? t("sourceCase") : summary.job !== null ? t("sourceUi") : summary.generation !== null ? t("sourcePlan") : null;
  return (
    <Panel id="symptom" title={t("title")} icon={<MessageSquareWarning />} actions={stage !== undefined && <StatusPill status={stage.status} tone={stage.tone} size="xs" />}>
      {summary.symptom === null ? (
        <p className="text-[13px] text-muted">{stage !== undefined && <StageDetailText detail={stage.detail} />}</p>
      ) : (
        <blockquote translate="no" className="whitespace-pre-wrap border-l-2 border-line-strong pl-4 text-[14px] leading-relaxed text-fg">{summary.symptom}</blockquote>
      )}
      {(source !== null || summary.benchmark !== null) && (
        <Meta
          className="mt-4"
          items={[
            ...(source === null ? [] : [{ label: t("source"), value: <span className="text-muted">{source}</span> }]),
            ...(summary.benchmark === null
              ? []
              : [
                  { label: t("caseKind"), value: summary.benchmark.kind === "positive" ? t("positive") : t("negative") },
                  { label: t("expectedOutcome"), value: <OutcomePill outcome={summary.benchmark.expected} size="xs" /> },
                  {
                    label: t("benchmarkResult"),
                    value: <StatusPill status={summary.benchmark.passed ? "PASS" : "FAIL"} tone={summary.benchmark.passed ? "ok" : "bad"} size="xs" />,
                  },
                ]),
          ]}
        />
      )}
    </Panel>
  );
}
