import { createRequire } from "node:module";
import { toErrorInfo } from "@exegezis/core";
import { EXIT, HELP, parseCliArgs, UsageError } from "./args.js";
import { compileCommand } from "./compile.js";
import { observeCommand } from "./observe.js";
import { reproduceCommand } from "./reproduce.js";
import { runCommand } from "./run.js";
import type { CliIo } from "./shared.js";
import { validateCommand } from "./validate.js";
import { verifyCommand } from "./verify.js";
import { benchmarkCommand } from "./benchmark.js";

const require = createRequire(import.meta.url);
export const VERSION = (require("../package.json") as { version: string }).version;

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const command = parseCliArgs(argv);
    const exegezisVersion = VERSION;
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
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`Error: ${error.message}\n`);
      return EXIT.usage;
    }
    const info = toErrorInfo(error);
    io.stderr.write(`Internal error: ${info.message}\n${info.stack ?? ""}\n`);
    return EXIT.internal;
  }
}

/** Entry point used by the `exegezis` binary. */
export async function run(): Promise<void> {
  process.exitCode = await main(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
  });
}
