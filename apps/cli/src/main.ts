import { createRequire } from "node:module";
import { toErrorInfo } from "@exegezis/core";
import { HELP, parseCliArgs, UsageError } from "./args.js";
import { observeCommand, type CliIo } from "./observe.js";

const require = createRequire(import.meta.url);
export const VERSION = (require("../package.json") as { version: string }).version;

export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const command = parseCliArgs(argv);
    switch (command.kind) {
      case "help":
        io.stdout.write(HELP);
        return 0;
      case "version":
        io.stdout.write(`${VERSION}\n`);
        return 0;
      case "observe":
        return await observeCommand({ ...command, exegezisVersion: VERSION }, io);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`Error: ${error.message}\n`);
      return 2;
    }
    const info = toErrorInfo(error);
    io.stderr.write(`Internal error: ${info.message}\n${info.stack ?? ""}\n`);
    return 3;
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
