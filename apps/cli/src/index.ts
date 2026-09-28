export { EXIT, parseCliArgs, UsageError, type Command } from "./args.js";
export { helpText } from "./help.js";
export { main, run, VERSION } from "./main.js";
export { buildObservePlan, observeCommand } from "./observe.js";
export { exitForOutcome, formatReport, verifyCommand } from "./verify.js";
export { benchmarkCommand } from "./benchmark.js";
export { verifyPlan } from "./pipeline.js";
export { validateCommand } from "./validate.js";
export type { CliIo } from "./shared.js";
