import { join } from "node:path";
import { runPreflight, ulid, validatePlan } from "@exegezis/core";
import { EXIT } from "./args.js";
import { absolute, createAdapter, displayPath, loadTestPlan, printer, runLogger, validationLines, type CliIo } from "./shared.js";
import { formatProvenance } from "./verify.js";
import { t } from "./i18n.js";

export interface ValidateOptions {
  planFile: string;
  baseUrl?: string;
  output: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

/**
 * `exegezis validate`: schema + semantic validation of a plan, checked
 * against a preflight observation of the target. Runs no step of the plan.
 */
export async function validateCommand(options: ValidateOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const { plan } = await loadTestPlan(io, options.planFile);
  const baseUrl = options.baseUrl ?? plan.target.baseUrl;
  const dir = join(absolute(io, options.output), "validations", `${ulid()}-${plan.id}`);

  out("EXEGEZIS");
  out();
  out(t("validate.title", { id: plan.id, title: plan.title }));
  out(t("validate.target", { url: baseUrl }));
  out(t("validate.provenance", { value: formatProvenance(plan.provenance) }));
  out();
  const preflight = await runPreflight({
    plan,
    baseUrl,
    adapter: createAdapter(options.headed),
    outputDir: join(dir, "preflight"),
    createLogger: (recorder) => runLogger(io, recorder, options.verbose),
    exegezisVersion: options.exegezisVersion,
  });
  const validation = validatePlan(plan, {
    descriptor: createAdapter(false).descriptor,
    mode: "verification",
    reference: preflight.pages,
    baseUrl,
  });

  out(t("validate.preflight", { count: preflight.pages.length }));
  if (validation.reference !== null) {
    out(t("validate.targets", { checked: validation.reference.targetsChecked, unchecked: validation.reference.targetsUnchecked }));
  }
  out(t("validate.timeouts", { action: String(validation.timeouts.actionMs), navigation: String(validation.timeouts.navigationMs), assertion: String(validation.timeouts.assertionMs), run: String(validation.timeouts.runMs) }));
  out();
  out(t("validate.status", { status: validation.status.toUpperCase() }));
  for (const line of validationLines(validation)) out(`  ${line}`);
  out();
  out(t("validate.evidence"));
  out(displayPath(io, preflight.runDir));

  switch (validation.status) {
    case "valid":
      return EXIT.ok;
    case "weakly_anchored":
      return EXIT.expectationFailed;
    case "invalid":
      return EXIT.invalidPlan;
    case "unsupported":
      return EXIT.unsupported;
  }
}
