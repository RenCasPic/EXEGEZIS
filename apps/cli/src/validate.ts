import { join } from "node:path";
import { describeValidation, runPreflight, ulid, validatePlan } from "@exegezis/core";
import { EXIT } from "./args.js";
import { absolute, createAdapter, displayPath, loadTestPlan, printer, runLogger, type CliIo } from "./shared.js";
import { formatProvenance } from "./verify.js";

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
  out(`Validating ${plan.id} — ${plan.title}`);
  out(`Target:     ${baseUrl}`);
  out(`Provenance: ${formatProvenance(plan.provenance)}`);
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

  out(`Preflight: ${preflight.pages.length} page(s) observed`);
  if (validation.reference !== null) {
    out(`Targets checked against the observed page: ${validation.reference.targetsChecked} (unchecked: ${validation.reference.targetsUnchecked})`);
  }
  out(`Timeouts: action ${validation.timeouts.actionMs} ms, navigation ${validation.timeouts.navigationMs} ms, assertion ${validation.timeouts.assertionMs} ms, run ${validation.timeouts.runMs} ms`);
  out();
  out(`Status: ${validation.status.toUpperCase()}`);
  for (const line of describeValidation(validation)) out(`  ${line}`);
  out();
  out("Preflight evidence:");
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
