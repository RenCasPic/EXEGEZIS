import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { SourceTag, StatusPill } from "@/components/ui/status";
import { getRootCauses } from "@/lib/evidence/investigations";
import { latestPerCase } from "@/lib/evidence/root-causes";
import { label, rootCauseTone } from "@/lib/evidence/stages";
import { absoluteTime, relativeTime } from "@/lib/format";

export const metadata: Metadata = { title: "Root causes" };

export default async function RootCausesPage() {
  const entries = await getRootCauses();
  const valid = entries.flatMap((e) => (e.report.status === "ok" ? [{ entry: e, report: e.report.value }] : []));
  const invalid = entries.filter((e) => e.report.status !== "ok");
  // Stats describe the latest result of each case; the table lists every run.
  const latest = latestPerCase(entries).flatMap((e) => (e.report.status === "ok" ? [{ entry: e, report: e.report.value }] : []));
  const evaluated = latest.map((l) => l.entry.evaluation).filter((e) => e !== null);
  const falseValidations = evaluated.filter((e) => e.falseValidation).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Root Causes"
        description="Causes established by intervention: each hypothesis' code change is applied to an isolated copy of the application and the reproduction is run again. A cause is VALIDATED only if its intervention removed the bug in every run and the competing hypotheses were refuted."
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label="Cases" value={latest.length} hint={`latest result of each · ${latest.reduce((n, v) => n + v.report.experiments.length, 0)} experiments`} />
        <Stat label="Validated" value={latest.filter((v) => v.report.decision.status === "VALIDATED").length} />
        <Stat label="Insufficient evidence" value={latest.filter((v) => v.report.decision.status === "INSUFFICIENT_EVIDENCE").length} hint="honest unknowns" />
        <Stat label="Hypotheses refuted" value={latest.reduce((n, v) => n + v.report.outcomes.filter((o) => o.status === "REFUTED").length, 0)} />
        <Stat
          label="False validations"
          value={<span className={falseValidations > 0 ? "text-critical" : "text-positive"}>{falseValidations}</span>}
          hint={`against the benchmark ground truth (${evaluated.length} evaluated)`}
        />
      </div>
      <Panel title={`${valid.length} root-cause investigations (every run)`} icon={<FlaskConical />} bodyClassName="p-0">
        {valid.length === 0 ? (
          <EmptyState title="No root-cause investigation yet">
            Run <code className="font-mono">pnpm exegezis root-cause</code>.
          </EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>Case</th>
                  <th className={tableClass.th}>Decision</th>
                  <th className={tableClass.th}>Root cause</th>
                  <th className={tableClass.th}>Experiment</th>
                  <th className={tableClass.th}>Refuted</th>
                  <th className={tableClass.th}>Ground truth</th>
                  <th className={tableClass.th}>When</th>
                </tr>
              </thead>
              <tbody>
                {valid.map(({ entry, report }) => {
                  const win = report.experiments.find((e) => e.hypothesisId === report.decision.hypothesisId);
                  const refuted = report.outcomes.filter((o) => o.status === "REFUTED").length;
                  const evaluation = entry.evaluation;
                  return (
                    <tr key={entry.ref.id} className={tableClass.tr}>
                      <td className={tableClass.td}>
                        <Link href={`/verification/root-causes/${entry.ref.id}`} className="font-mono text-[12px] font-medium text-accent hover:underline">
                          {entry.ref.caseId}
                        </Link>
                        <div className="mt-0.5">
                          <SourceTag kind={entry.ref.archived ? "archived" : "real"} />
                        </div>
                      </td>
                      <td className={tableClass.td}>
                        <StatusPill status={label(report.decision.status)} tone={rootCauseTone(report.decision.status)} size="xs" />
                      </td>
                      <td className={`${tableClass.td} max-w-[26rem] text-[12px] text-muted`}>{report.decision.statement ?? report.decision.reason}</td>
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
                          <span className="text-critical">FALSE VALIDATION</span>
                        ) : evaluation.correct === true ? (
                          <span className="text-positive">correct</span>
                        ) : (
                          <span className="text-muted">{evaluation.matchesExpected ? "honest unknown (expected)" : `expected ${evaluation.expectedStatus}`}</span>
                        )}
                      </td>
                      <td className={`${tableClass.td} whitespace-nowrap text-muted`} title={absoluteTime(report.generatedAt)}>
                        {relativeTime(report.generatedAt)}
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
        <p className="text-xs text-critical">
          {invalid.length} report(s) failed schema validation and are not shown (a decision that does not follow from its experiments is rejected):{" "}
          {invalid.map((e) => e.ref.relDir).join(", ")}
        </p>
      )}
    </div>
  );
}
