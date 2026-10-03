import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { SourceTag, StatusPill } from "@/components/ui/status";
import { getRootCauses } from "@/lib/evidence/investigations";
import { latestPerCase } from "@/lib/evidence/root-causes";
import { decideRootCause } from "@exegezis/core";
import { EngineText } from "@/components/ui/engine-text";
import { rootCauseTone } from "@/lib/evidence/stages";
import { getFormat } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("rootCauses.list"))("title") };
}

export default async function RootCausesPage() {
  const [entries, t, status, f] = await Promise.all([getRootCauses(), getTranslations("rootCauses.list"), getTranslations("labels.status"), getFormat()]);
  const valid = entries.flatMap((e) => (e.report.status === "ok" ? [{ entry: e, report: e.report.value }] : []));
  const invalid = entries.filter((e) => e.report.status !== "ok");
  // Stats describe the latest result of each case; the table lists every run.
  const latest = latestPerCase(entries).flatMap((e) => (e.report.status === "ok" ? [{ entry: e, report: e.report.value }] : []));
  const evaluated = latest.map((l) => l.entry.evaluation).filter((e) => e !== null);
  const falseValidations = evaluated.filter((e) => e.falseValidation).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label={t("cases")} value={latest.length} hint={t("casesHint", { count: latest.reduce((n, v) => n + v.report.experiments.length, 0) })} />
        <Stat label={t("validated")} value={latest.filter((v) => v.report.decision.status === "VALIDATED").length} />
        <Stat label={t("insufficient")} value={latest.filter((v) => v.report.decision.status === "INSUFFICIENT_EVIDENCE").length} hint={t("insufficientHint")} />
        <Stat label={t("refuted")} value={latest.reduce((n, v) => n + v.report.outcomes.filter((o) => o.status === "REFUTED").length, 0)} />
        <Stat
          label={t("falseValidations")}
          value={<span className={falseValidations > 0 ? "text-bad" : "text-ok"}>{falseValidations}</span>}
          hint={t("falseValidationsHint", { count: evaluated.length })}
        />
      </div>
      <Panel title={t("panel", { count: valid.length })} icon={<FlaskConical />} bodyClassName="p-0">
        {valid.length === 0 ? (
          <EmptyState title={t("none")}>{t("noneBody", { command: "pnpm exegezis root-cause" })}</EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>{t("colCase")}</th>
                  <th className={tableClass.th}>{t("colDecision")}</th>
                  <th className={tableClass.th}>{t("colEvidence")}</th>
                  <th className={tableClass.th}>{t("colRootCause")}</th>
                  <th className={tableClass.th}>{t("colExperiment")}</th>
                  <th className={tableClass.th}>{t("colRefuted")}</th>
                  <th className={tableClass.th}>{t("colGroundTruth")}</th>
                  <th className={tableClass.th}>{t("colWhen")}</th>
                </tr>
              </thead>
              <tbody>
                {valid.map(({ entry, report }) => {
                  const win = report.experiments.find((e) => e.hypothesisId === (report.decision.hypothesisId ?? report.decision.candidateHypothesisId));
                  const refuted = report.outcomes.filter((o) => o.status === "REFUTED").length;
                  const evaluation = entry.evaluation;
                  return (
                    <tr key={entry.ref.id} className={tableClass.tr}>
                      <td className={tableClass.td}>
                        <Link href={`/verification/root-causes/${entry.ref.id}`} className="font-mono text-[12px] font-medium text-accent-text hover:underline">
                          {entry.ref.caseId}
                        </Link>
                        <div className="mt-0.5">
                          <SourceTag kind={entry.ref.archived ? "archived" : "real"} />
                        </div>
                      </td>
                      <td className={tableClass.td}>
                        <StatusPill status={report.decision.status} tone={rootCauseTone(report.decision.status)} size="xs" />
                      </td>
                      <td className={`${tableClass.td} font-mono text-[11px] text-muted`}>{status(report.decision.evidenceLevel)}</td>
                      <td className={`${tableClass.td} max-w-[26rem] text-[12px] text-muted`}>
                        {report.decision.status === "VALIDATED" ? (
                          <span translate="no">{report.decision.statement}</span>
                        ) : report.decision.candidateHypothesisId !== null ? (
                          <>
                            {t("candidate", { id: report.decision.candidateHypothesisId })} <span translate="no">{report.decision.statement ?? ""}</span>
                          </>
                        ) : (
                          <EngineText message={report.decision.message ?? decideRootCause(report.baseline, report.experiments, report.outcomes, report.policy).message} text={report.decision.reason} />
                        )}
                      </td>
                      <td className={`${tableClass.td} whitespace-nowrap font-mono text-[12px]`}>
                        {win === undefined ? "—" : `${win.baseline.reproduced}/${win.baseline.runs} → ${win.arm.counts.reproduced}/${win.arm.counts.runs}`}
                      </td>
                      <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>
                        {refuted}/{report.hypotheses.length}
                      </td>
                      <td className={`${tableClass.td} text-[12px]`}>
                        {evaluation === null ? (
                          <span className="text-faint">—</span>
                        ) : evaluation.falseValidation ? (
                          <span className="text-bad">{status("FALSE_VALIDATION")}</span>
                        ) : evaluation.correct === true ? (
                          <span className="text-ok">{t("correct")}</span>
                        ) : (
                          <span className="text-muted">{evaluation.matchesExpected ? t("honestUnknown") : t("expectedStatus", { status: status(evaluation.expectedStatus) })}</span>
                        )}
                      </td>
                      <td className={`${tableClass.td} whitespace-nowrap text-muted`} title={f.absolute(report.generatedAt)}>
                        {f.relative(report.generatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {invalid.length > 0 && (
        <p className="text-xs text-bad">
          {t("invalid", { count: invalid.length })}{" "}
          {invalid.map((e) => e.ref.relDir).join(", ")}
        </p>
      )}
    </div>
  );
}
