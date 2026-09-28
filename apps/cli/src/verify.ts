import { join } from "node:path";
import { ulid, type BugReport, type EvidenceRef, type VerificationOutcome } from "@exegezis/core";
import { EXIT } from "./args.js";
import { BUG_REPORT_FILE, verifyPlan } from "./pipeline.js";
import { absolute, displayPath, loadTestPlan, percent, printer, validationLines, type CliIo } from "./shared.js";
import { engineText, t } from "./i18n.js";

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
  out(t("verify.target", { url: options.baseUrl ?? plan.target.baseUrl }));
  out(t("verify.provenance", { value: formatProvenance(plan.provenance) }));
  out();
  const result = await verifyPlan(io, loaded, { ...options, dir, progress: true });
  out();
  for (const line of formatReport(result.report)) out(line);
  out();
  if (result.specPath !== undefined) {
    out(t("verify.compiled"));
    out(displayPath(io, result.specPath, false));
    out();
  }
  out(t("verify.report"));
  out(displayPath(io, join(dir, BUG_REPORT_FILE), false));
  return exitForOutcome(result.report.outcome);
}

export function formatProvenance(provenance: BugReport["provenance"]): string {
  const details = [provenance.generator, provenance.model, provenance.version].filter((v) => v !== null);
  return details.length === 0 ? provenance.source : `${provenance.source} (${details.join(", ")})`;
}

const EVIDENCE_KINDS = ["timeline", "screenshot", "accessibility", "console", "network", "trace"] as const satisfies readonly EvidenceRef["kind"][];
const CRITERIA = ["plan_valid", "expectation_defined", "anchored", "reproduced", "evidence_captured", "executable_test"] as const;

export function formatReport(report: BugReport): string[] {
  const lines: string[] = [];
  lines.push(t("verify.validation"));
  lines.push(report.validation.status.toUpperCase());
  for (const line of validationLines(report.validation)) {
    lines.push(`  ${line}`);
  }
  lines.push("");

  const executed = report.reproduction.attempts > 0;
  if (executed) {
    lines.push(t("verify.expected"));
    if (report.expected === null) {
      lines.push(t("verify.noExpected"));
    } else {
      lines.push(report.expected.description);
      lines.push(`  ${JSON.stringify(report.expected.value)}`);
    }
    lines.push("");
    lines.push(t("verify.observed"));
    if (report.actual === null) {
      lines.push(t("verify.noObserved"));
    } else {
      lines.push(`  ${JSON.stringify(report.actual.value)}`);
      lines.push(`  ${engineText(report.actual.detail, report.actual.message)}`);
    }
    lines.push("");
    const r = report.reproduction;
    lines.push(t("verify.reproduction"));
    lines.push(t("verify.failedOf", { failures: r.failures, attempts: r.attempts, rate: percent(r.rate), status: r.status }));
    if (r.status !== "REPRODUCED") lines.push(`  ${engineText(r.message, r.reason)}`);
    lines.push("");
    lines.push(t("verify.evidence"));
    const kinds = new Set(report.evidence.map((e) => e.kind));
    for (const kind of EVIDENCE_KINDS) lines.push(`${kinds.has(kind) ? "✓" : "✗"} ${t(`verify.evidenceKind.${kind}`)}`);
    lines.push("");
    lines.push(t("verify.verification"));
    const test = report.compiledTest;
    lines.push(
      test === null
        ? t("verify.notRun")
        : test.status === "failed"
          ? t("verify.failBeforeFix", { step: String(test.failedAtStep ?? "?") })
          : test.status === "passed"
            ? t("verify.passed")
            : t("verify.couldNotRun", { message: test.message ?? test.status }),
    );
    lines.push("");
  } else {
    lines.push(t("verify.reproduction"));
    lines.push(t("verify.notExecuted"));
    lines.push("");
  }

  lines.push(t("verify.criteria"));
  for (const criterion of report.criteria) {
    const known = (CRITERIA as readonly string[]).includes(criterion.id);
    lines.push(`${criterion.met ? "✓" : "✗"} ${known ? t(`verify.criterion.${criterion.id}`) : criterion.description}`);
    lines.push(`    ${engineText(criterion.message, criterion.detail)}`);
  }
  lines.push("");
  lines.push(t("verify.outcome"));
  lines.push(report.outcome === "VERIFIED" ? t("verify.verifiedBug") : report.outcome.replace("_", " "));
  lines.push(`  ${engineText(report.outcomeMessage, report.outcomeReason)}`);
  return lines;
}
