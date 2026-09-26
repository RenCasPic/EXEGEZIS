import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { isEngineUnavailable, toErrorInfo } from "@exegezis/core";
import { EXIT, HELP, parseCliArgs, UsageError } from "./args.js";
import { compileCommand } from "./compile.js";
import { observeCommand } from "./observe.js";
import { reproduceCommand } from "./reproduce.js";
import { runCommand } from "./run.js";
import type { CliIo } from "./shared.js";
import { validateCommand } from "./validate.js";
import { verifyCommand } from "./verify.js";
import { benchmarkCommand } from "./benchmark.js";
import { aiVerifyCommand, generatePlanCommand } from "./ai-commands.js";
import { inspectCommand } from "./inspect.js";
import { doctorCommand, printEngineError } from "./doctor.js";
import { rootCauseCommand } from "./root-cause.js";
import { useBrowserChannel } from "./shared.js";

const require = createRequire(import.meta.url);
export const VERSION = (require("../package.json") as { version: string }).version;

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const command = parseCliArgs(argv);
    const exegezisVersion = VERSION;
    if ("browserChannel" in command) useBrowserChannel(command.browserChannel);
    switch (command.kind) {
      case "help":
        io.stdout.write(HELP);
        return EXIT.ok;
      case "version":
        io.stdout.write(`${VERSION}\n`);
        return EXIT.ok;
      case "observe":
        return await observeCommand({ ...command, exegezisVersion }, io);
      case "run":
        return await runCommand({ ...command, exegezisVersion }, io);
      case "reproduce":
        return await reproduceCommand({ ...command, exegezisVersion }, io);
      case "compile":
        return await compileCommand({ ...command, exegezisVersion }, io);
      case "verify":
        return await verifyCommand({ ...command, exegezisVersion }, io);
      case "validate":
        return await validateCommand({ ...command, exegezisVersion }, io);
      case "benchmark":
        return await benchmarkCommand({ ...command, exegezisVersion }, io);
      case "generate-plan":
        return await generatePlanCommand({ ...command, exegezisVersion }, io);
      case "ai-verify":
        return await aiVerifyCommand({ ...command, exegezisVersion }, io);
      case "root-cause":
        return await rootCauseCommand({ ...command, exegezisVersion }, io);
      case "inspect":
        return await inspectCommand({ ...command, exegezisVersion }, io);
      case "doctor":
        return await doctorCommand(command, io, VERSION);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`Error: ${error.message}\n`);
      return EXIT.usage;
    }
    if (isEngineUnavailable(error)) {
      // Not a verdict: nothing was concluded about the target.
      printEngineError(io, error.toInfo());
      return EXIT.engineError;
    }
    const info = toErrorInfo(error);
    io.stderr.write(`Internal error: ${info.message}\n${info.stack ?? ""}\n`);
    return EXIT.internal;
  }
}

/**
 * Loads `.env` from the working directory, if present, for local secrets such
 * as EXEGEZIS_ANTHROPIC_API_KEY. Variables already set in the environment win.
 */
function loadDotEnv(cwd: string): void {
  const path = join(cwd, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

/** Entry point used by the `exegezis` binary. */
export async function run(): Promise<void> {
  loadDotEnv(process.cwd());
  process.exitCode = await main(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
  });
}
