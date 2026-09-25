import { join } from "node:path";
import { describeValidation, ulid, type BugReport, type EvidenceRef, type VerificationOutcome } from "@exegezis/core";
import { EXIT } from "./args.js";
import { BUG_REPORT_FILE, verifyPlan } from "./pipeline.js";
import { absolute, displayPath, loadTestPlan, percent, printer, type CliIo } from "./shared.js";

export interface VerifyOptions {
  planFile: string;
  baseUrl?: string;
  runs: number;
  output: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

/** Exit code for each verification outcome: every state is distinguishable. */
export function exitForOutcome(outcome: VerificationOutcome): number {
  switch (outcome) {
    case "VERIFIED":
      return EXIT.ok;
    case "NOT_VERIFIED":
    case "FLAKY":
      return EXIT.expectationFailed;
    case "INCONCLUSIVE":
      return EXIT.inconclusive;
    case "INVALID_PLAN":
      return EXIT.invalidPlan;
    case "UNSUPPORTED":
      return EXIT.unsupported;
  }
}

/**
 * `exegezis verify`: preflight → validation → reproduction → compiled spec →
 * Playwright → criteria → bug report. Nothing is taken from a person's or a
 * model's opinion.
 */
export async function verifyCommand(options: VerifyOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const loaded = await loadTestPlan(io, options.planFile);
  const { plan } = loaded;
  const dir = join(absolute(io, options.output), "verifications", `${ulid()}-${plan.id}`);

  out("EXEGEZIS");
  out();
  out(plan.id);
  out("─".repeat(44));
  out(plan.title);
  out(`Target:     ${options.baseUrl ?? plan.target.baseUrl}`);
  out(`Provenance: ${formatProvenance(plan.provenance)}`);
  out();
  const result = await verifyPlan(io, loaded, { ...options, dir, progress: true });
  out();
  for (const line of formatReport(result.report)) out(line);
  out();
  if (result.specPath !== undefined) {
    out("Compiled test:");
    out(displayPath(io, result.specPath, false));
    out();
  }
  out("Report:");
  out(displayPath(io, join(dir, BUG_REPORT_FILE), false));
  return exitForOutcome(result.report.outcome);
}

export function formatProvenance(provenance: BugReport["provenance"]): string {
  const details = [provenance.generator, provenance.model, provenance.version].filter((v) => v !== null);
  return details.length === 0 ? provenance.source : `${provenance.source} (${details.join(", ")})`;
}

const EVIDENCE_LABELS: [kind: EvidenceRef["kind"], label: string][] = [
  ["timeline", "Timeline"],
  ["screenshot", "Screenshot"],
  ["accessibility", "Accessibility"],
  ["console", "Console"],
  ["network", "Network"],
  ["trace", "Trace"],
];

export function formatReport(report: BugReport): string[] {
  const lines: string[] = [];
  lines.push("Validation:");
  lines.push(report.validation.status.toUpperCase());
  for (const line of describeValidation(report.validation)) {
    lines.push(`  ${line}`);
  }
  lines.push("");

  const executed = report.reproduction.attempts > 0;
  if (executed) {
    lines.push("Expected:");
    if (report.expected === null) {
      lines.push("(no failed expectation to show)");
    } else {
      lines.push(report.expected.description);
      lines.push(`  ${JSON.stringify(report.expected.value)}`);
    }
    lines.push("");
    lines.push("Observed:");
    if (report.actual === null) {
      lines.push("(no failure observed)");
    } else {
      lines.push(`  ${JSON.stringify(report.actual.value)}`);
      lines.push(`  ${report.actual.message}`);
    }
    lines.push("");
    const r = report.reproduction;
    lines.push("Reproduction:");
    lines.push(`${r.failures} / ${r.attempts} failed (${percent(r.rate)}) — ${r.status}`);
    if (r.status !== "REPRODUCED") lines.push(`  ${r.reason}`);
    lines.push("");
    lines.push("Evidence:");
    const kinds = new Set(report.evidence.map((e) => e.kind));
    for (const [kind, label] of EVIDENCE_LABELS) lines.push(`${kinds.has(kind) ? "✓" : "✗"} ${label}`);
    lines.push("");
    lines.push("Verification:");
    const test = report.compiledTest;
    lines.push(
      test === null
        ? "compiled test not run"
        : test.status === "failed"
          ? `FAIL before fix (Playwright failed at step ${test.failedAtStep ?? "?"})`
          : test.status === "passed"
            ? "the compiled test PASSED (it does not demonstrate a failure)"
            : `the compiled test could not run: ${test.message ?? test.status}`,
    );
    lines.push("");
  } else {
    lines.push("Reproduction:");
    lines.push("not executed");
    lines.push("");
  }

  lines.push("Criteria:");
  for (const criterion of report.criteria) {
    lines.push(`${criterion.met ? "✓" : "✗"} ${criterion.description}`);
    lines.push(`    ${criterion.detail}`);
  }
  lines.push("");
  lines.push("Outcome:");
  lines.push(report.outcome === "VERIFIED" ? "VERIFIED BUG" : report.outcome.replace("_", " "));
  lines.push(`  ${report.outcomeReason}`);
  return lines;
}
