import { Check, ShieldCheck, X } from "lucide-react";
import type { RootCauseReport } from "@exegezis/core";
import { CodeBlock, Meta, Mono, tableClass } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import type { RootCauseEntry } from "@/lib/evidence/root-causes";
import { label, rootCauseTone, type Tone } from "@/lib/evidence/stages";
import { absoluteTime } from "@/lib/format";
import { artifactUrl } from "@/lib/urls";

const EXPERIMENT_TONE: Record<string, Tone> = { CONFIRMED: "ok", FALSIFIED: "off", INCONCLUSIVE: "q" };
const EVIDENCE_TONE: Record<string, Tone> = { met: "ok", not_met: "bad", unknown: "q", not_applicable: "q" };
const EVIDENCE_MARK: Record<string, string> = { met: "✓", not_met: "✗", unknown: "?", not_applicable: "—" };
const SPECIFICITY_TONE: Record<string, Tone> = { surgical: "ok", not_surgical: "off", unknown: "q" };
const HYPOTHESIS_TONE: Record<string, Tone> = { SUPPORTED: "ok", REFUTED: "off", UNRESOLVED: "q" };

function Counts({ reproduced, runs, invalid }: { reproduced: number; runs: number; invalid: number }) {
  return (
    <span className="font-mono text-[12px] text-fg">
      {reproduced}/{runs}
      {invalid > 0 && <span className="ml-1 text-warn">({invalid} invalid)</span>}
    </span>
  );
}

/**
 * A root-cause report as recorded, section by section: decision, the
 * observations the hypotheses rely on, every experiment with its numbers,
 * the alternatives and how they ended, and the isolation proof.
 */
export function RootCauseView({ entry, report }: { entry: RootCauseEntry; report: RootCauseReport }) {
  const d = report.decision;
  const focus = d.hypothesisId ?? d.candidateHypothesisId;
  const winner = report.hypotheses.find((h) => h.id === focus) ?? null;
  const winnerExperiment = report.experiments.find((e) => e.hypothesisId === focus) ?? null;
  const isCandidate = d.status !== "VALIDATED" && d.candidateHypothesisId !== null;
  const files = [
    "root-cause-report.json",
    `${report.baseline.path}/reproduction.json`,
    ...(report.baseline.control === null ? [] : [`${report.baseline.control.path}/reproduction.json`]),
    ...report.experiments.flatMap((e) => [
      `${e.arm.path}/reproduction.json`,
      ...(e.arm.mutation === null ? [] : [`${e.arm.path}/mutation.diff`]),
      ...(e.arm.control === null ? [] : [`${e.arm.control.path}/reproduction.json`]),
      ...(e.reversal === null ? [] : [`${e.reversal.path}/reproduction.json`]),
    ]),
    ...(entry.evaluation === null ? [] : ["evaluation.json"]),
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={label(d.status)} tone={rootCauseTone(d.status)} />
          <StatusPill status={`EVIDENCE: ${d.evidenceLevel}`} tone={d.evidenceLevel === "VALIDATED" ? "ok" : "q"} size="xs" />
          {focus !== null && <span className="font-mono text-[12px] text-muted">{focus}</span>}
        </div>
        {isCandidate && (
          <div className="text-[11px] font-medium text-warn">Root cause candidate — not validated</div>
        )}
        {d.statement !== null && <div className={cn("text-[15px] font-medium", isCandidate ? "text-muted" : "text-fg")}>{d.statement}</div>}
        <div className="text-[13px] text-muted">{d.reason}</div>
        {winnerExperiment !== null && (
          <div
            className={cn(
              "mt-1 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-[13px]",
              isCandidate ? "border-line bg-panel-2" : "border-ok/30 bg-ok-bg",
            )}
          >
            <span className="text-muted">Experiment {winnerExperiment.id}</span>
            <span className="font-mono text-fg">
              {winnerExperiment.baseline.reproduced}/{winnerExperiment.baseline.runs} → {winnerExperiment.arm.counts.reproduced}/{winnerExperiment.arm.counts.runs}
            </span>
            <span className="text-muted">bug reproduced (baseline → with the intervention)</span>
          </div>
        )}
      </div>

      {winner !== null && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-line p-3">
            <div className="mb-1 text-xs font-medium text-muted">Prediction</div>
            <div className="text-[13px] text-fg">
              If {winner.id} is the cause, this intervention removes the bug in every run: <span className="text-muted">{winner.intervention.description}</span>
            </div>
          </div>
          <div className="rounded-md border border-line p-3">
            <div className="mb-1 text-xs font-medium text-muted">Result</div>
            <div className="text-[13px] text-fg">{winnerExperiment?.result.reason}</div>
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-medium text-muted">
          Evidence matrix{focus === null ? "" : ` · ${focus}`}
        </div>
        <div className={cn(tableClass.wrap, "rounded-md border border-line")}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>Evidence</th>
                <th className={tableClass.th}>Status</th>
                <th className={tableClass.th}>Required</th>
                <th className={tableClass.th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {report.evidence.map((item) => (
                <tr key={item.id} className={tableClass.tr}>
                  <td className={`${tableClass.td} text-[13px] text-fg`}>{item.label}</td>
                  <td className={tableClass.td}>
                    <StatusPill status={`${EVIDENCE_MARK[item.status] ?? ""} ${item.status.replace("_", " ")}`} tone={EVIDENCE_TONE[item.status] ?? "q"} size="xs" />
                  </td>
                  <td className={`${tableClass.td} text-[12px] text-muted`}>{item.required ? "yes" : "no"}</td>
                  <td className={`${tableClass.td} max-w-[28rem] text-[12px] text-muted`}>{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Every status is recomputed from the recorded measurements when the report is loaded. Execution coverage shows relevance, never causality.
        </p>
      </div>

      {report.observations.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Evidence the hypotheses rely on</div>
          <ul className="flex flex-col gap-1.5">
            {report.observations.map((o) => (
              <li key={o.id} className="rounded-md border border-line px-3 py-2">
                <div className="text-[13px] text-fg">{o.statement}</div>
                <div className="font-mono text-[11px] text-faint">
                  {o.id} · {o.source}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-medium text-muted">Experiments</div>
        <div className={cn(tableClass.wrap, "rounded-md border border-line")}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>Hypothesis</th>
                <th className={tableClass.th}>Intervention</th>
                <th className={tableClass.th}>Baseline</th>
                <th className={tableClass.th}>With intervention</th>
                <th className={tableClass.th}>Prediction</th>
                <th className={tableClass.th}>Result</th>
                <th className={tableClass.th}>Site ran</th>
                <th className={tableClass.th}>Specificity</th>
                <th className={tableClass.th}>Reversal</th>
              </tr>
            </thead>
            <tbody>
              {report.experiments.map((e) => (
                <tr key={e.id} className={tableClass.tr}>
                  <td className={`${tableClass.td} font-mono text-[12px] text-fg`}>{e.hypothesisId}</td>
                  <td className={`${tableClass.td} max-w-[22rem] text-[12px] text-muted`}>
                    <span className="font-mono text-faint">{e.intervention.file}</span> · {e.intervention.description}
                  </td>
                  <td className={tableClass.td}>
                    <Counts {...e.baseline} />
                  </td>
                  <td className={tableClass.td}>
                    <Counts reproduced={e.arm.counts.reproduced} runs={e.arm.counts.runs} invalid={e.arm.counts.invalid} />
                  </td>
                  <td className={`${tableClass.td} font-mono text-[11px] text-muted`}>bug {e.prediction === "eliminates" ? "disappears" : "persists"}</td>
                  <td className={tableClass.td}>
                    <StatusPill status={e.result.status} tone={EXPERIMENT_TONE[e.result.status] ?? "q"} size="xs" />
                  </td>
                  <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{e.site.executions === null ? "?" : `${e.site.executions}×`}</td>
                  <td className={tableClass.td} title={e.specificity.reason}>
                    <StatusPill status={e.specificity.status.replace("_", " ")} tone={SPECIFICITY_TONE[e.specificity.status] ?? "q"} size="xs" />
                  </td>
                  <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>
                    {e.reversal === null ? "—" : `${e.reversal.counts.reproduced}/${e.reversal.counts.runs}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.experiments.length === 0 && <p className="mt-2 text-xs text-faint">No experiment ran: {d.reason}</p>}
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-muted">Hypotheses</div>
        <ul className="flex flex-col gap-2">
          {report.hypotheses.map((h) => {
            const o = report.outcomes.find((x) => x.id === h.id);
            const e = report.experiments.find((x) => x.hypothesisId === h.id);
            return (
              <li key={h.id}>
                <details className="group rounded-md border border-line" open={h.id === d.hypothesisId}>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                    <span className="font-mono text-[12px] text-faint">{h.id}</span>
                    {o !== undefined && <StatusPill status={o.status} tone={HYPOTHESIS_TONE[o.status] ?? "q"} size="xs" />}
                    <span className="min-w-0 flex-1 text-[13px] text-fg">{h.statement}</span>
                    <span className="text-[11px] text-faint">proposed by {h.provenance.source === "model" ? (h.provenance.model ?? "a model") : h.provenance.generator ?? h.provenance.source}</span>
                  </summary>
                  <div className="flex flex-col gap-3 border-t border-line px-3 py-3 text-[13px]">
                    <Meta
                      items={[
                        { label: "Why we believed it", value: <span className="text-muted">{h.rationale}</span> },
                        { label: "Location", value: <Mono>{`${h.location.file}${h.location.symbol === undefined ? "" : ` · ${h.location.symbol}`}`}</Mono> },
                        { label: "Relies on", value: h.observations.length === 0 ? "—" : <Mono>{h.observations.join(", ")}</Mono> },
                        { label: "What happened", value: <span className="text-muted">{o?.reason ?? "—"}</span> },
                      ]}
                    />
                    {e?.arm.mutation != null && <CodeBlock code={e.arm.mutation.diff} lineNumbers={false} maxHeight="14rem" />}
                    {e !== undefined && e.specificity.changed.length > 0 && (
                      <div className="rounded-md border border-bad/30 bg-bad-bg p-2 text-[12px]">
                        <div className="mb-1 text-muted">Execution changed in the control scenario (where the baseline is correct):</div>
                        <ul className="font-mono text-[11px] text-fg">
                          {e.specificity.changed.map((c) => (
                            <li key={c.key}>
                              {c.key}: {c.baseline} → {c.other}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {e !== undefined && e.arm.attempts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {e.arm.attempts.map((a) => (
                          <span
                            key={a.runId}
                            title={`${a.runId} · ${a.verdict}${a.stoppedAtStep === undefined ? "" : ` at step ${a.stoppedAtStep}`}`}
                            className={cn(
                              "rounded border px-1.5 py-px font-mono text-[10px]",
                              a.classification === "reproduced" ? "border-bad/40 text-bad" : a.classification === "not_reproduced" ? "border-ok/40 text-ok" : "border-warn/40 text-warn",
                            )}
                          >
                            #{a.attempt} {a.classification.replace("_", " ")}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-line p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
            <ShieldCheck className="size-3.5" /> Isolation
          </div>
          <Meta
            className="text-[12px]"
            items={[
              { label: "Source", value: <Mono>{report.isolation.sourceDir}</Mono> },
              { label: "Files hashed", value: report.isolation.files },
              {
                label: "Unchanged",
                value: report.isolation.unchanged ? (
                  <span className="flex items-center gap-1 text-ok">
                    <Check className="size-3.5" /> source tree identical before and after
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-bad">
                    <X className="size-3.5" /> source tree changed
                  </span>
                ),
              },
              { label: "Runs per arm", value: report.policy.runsPerArm },
              { label: "Alternatives to refute", value: `≥ ${report.policy.minRefutedAlternatives}` },
              { label: "Control runs per arm", value: report.policy.controlRuns },
              { label: "Generated", value: absoluteTime(report.generatedAt) },
            ]}
          />
        </div>
        <div className="rounded-md border border-line p-3">
          <div className="mb-2 text-xs font-medium text-muted">Artifacts</div>
          <ul className="flex flex-col gap-1 font-mono text-[12px]">
            {files.map((f) => (
              <li key={f}>
                <a href={artifactUrl(entry.ref.id, f)} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                  {f}
                </a>
              </li>
            ))}
          </ul>
          {entry.evaluation !== null && (
            <div className="mt-3 border-t border-line pt-3 text-[12px]">
              <div className="mb-1 text-[11px] text-faint">Benchmark ground truth (never shown to the engine)</div>
              <div className={entry.evaluation.falseValidation ? "text-bad" : entry.evaluation.correct === true ? "text-ok" : "text-muted"}>{entry.evaluation.detail}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
