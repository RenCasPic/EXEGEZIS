import { parseArgs } from "node:util";

export class UsageError extends Error {
  override readonly name = "UsageError";
}

export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | {
      kind: "observe";
      url: string;
      output: string;
      actionsFile?: string;
      headed: boolean;
      verbose: boolean;
    };

export const HELP = `EXEGEZIS — Software that explains itself.

Usage:
  exegezis observe --url <url> [--output <dir>] [--actions <plan.json>] [--headed] [--verbose]
  exegezis --help | --version

Commands:
  observe   Open <url> in a browser, execute the optional action plan and
            record the evidence (timeline, console, network, accessibility,
            screenshots, DOM, trace) into <output>/<runId>/.

Options:
  --url <url>          Target URL (http or https). Required.
  --output <dir>       Directory for run folders. Default: ./runs
  --actions <file>     JSON plan (exegezis.plan/v1) executed after the page loads.
  --headed             Show the browser window.
  --verbose            Also stream structured logs to stderr.

Exit codes:
  0  run completed     1  run failed (evidence kept)
  2  usage error       3  internal error (run could not be recorded)
`;

export function parseCliArgs(argv: readonly string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        url: { type: "string" },
        output: { type: "string", default: "./runs" },
        actions: { type: "string" },
        headed: { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  const { values, positionals } = parsed;
  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const [command, ...extra] = positionals;
  if (command === undefined) return { kind: "help" };
  if (command !== "observe") throw new UsageError(`Unknown command "${command}". Run "exegezis --help".`);
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}".`);

  if (values.url === undefined || values.url === "") throw new UsageError("Missing required option --url <url>.");
  let url: URL;
  try {
    url = new URL(values.url);
  } catch {
    throw new UsageError(`Invalid --url "${values.url}".`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError(`--url must use http or https, got "${url.protocol}".`);
  }
  if (values.output === "") throw new UsageError("--output must not be empty.");

  return {
    kind: "observe",
    url: url.toString(),
    output: values.output,
    ...(values.actions === undefined ? {} : { actionsFile: values.actions }),
    headed: values.headed,
    verbose: values.verbose,
  };
}
