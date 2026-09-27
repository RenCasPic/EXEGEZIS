import { parseArgs } from "node:util";
import { BROWSER_CHANNELS, UsageError, type BrowserChannelArg } from "./args.js";

/*
 * `exegezis search …` (docs/10-search.md): its own parser, because it has
 * sub-actions and many options that no other command takes.
 */

export const SEARCH_ACTIONS = ["run", "suggest", "export", "templates"] as const;
export type SearchAction = (typeof SEARCH_ACTIONS)[number];

export interface SearchRunArgs {
  kind: "search";
  action: "run";
  url?: string;
  terms?: string;
  meaning?: string;
  template?: string;
  /** Templates: also run the meaning part (uses the model). */
  withMeaning: boolean;
  variants: boolean;
  excludeScope: "block" | "page";
  regex?: string;
  /** JSON list of accepted suggestions: [{"term","from","relation"}]. */
  suggested?: string;
  runs?: number;
  maxPages?: number;
  maxDepth?: number;
  pageTimeoutMs?: number;
  totalTimeoutMs?: number;
  delayMs?: number;
  strictReadonly?: boolean;
  ignoreRobots: boolean;
  noSession: boolean;
  includeHidden: boolean;
  maxCostUsd?: number;
  model?: string;
  mockResponse?: string;
  saved?: string;
  save?: string;
  reuse?: string;
  output: string;
  headed: boolean;
  browserChannel: BrowserChannelArg;
}

export interface SearchSuggestArgs {
  kind: "search";
  action: "suggest";
  terms: string;
  model?: string;
  maxCostUsd?: number;
  mockResponse?: string;
  json: boolean;
}

export interface SearchExportArgs {
  kind: "search";
  action: "export";
  search: string;
  format: "csv" | "pdf";
  separator: ";" | "," | "\t";
  out?: string;
  output: string;
  browserChannel: BrowserChannelArg;
}

export interface SearchTemplatesArgs {
  kind: "search";
  action: "templates";
  json: boolean;
}

export type SearchCommand = SearchRunArgs | SearchSuggestArgs | SearchExportArgs | SearchTemplatesArgs;

const ALLOWED: Record<SearchAction, string[]> = {
  run: [
    "url", "terms", "meaning", "template", "with-meaning", "variants", "exclude-scope", "regex", "suggested", "runs", "max-pages", "max-depth", "page-timeout", "total-timeout", "delay",
    "strict-readonly", "allow-page-writes", "ignore-robots", "no-session", "no-hidden", "max-cost", "model", "mock-response", "saved", "save", "reuse", "output", "headed", "browser-channel",
  ],
  suggest: ["terms", "model", "max-cost", "mock-response", "json"],
  export: ["search", "format", "sep", "out", "output", "browser-channel"],
  templates: ["json"],
};

export function parseSearchArgs(argv: readonly string[]): SearchCommand {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        url: { type: "string" },
        terms: { type: "string" },
        meaning: { type: "string" },
        template: { type: "string" },
        "with-meaning": { type: "boolean", default: false },
        variants: { type: "boolean", default: false },
        "exclude-scope": { type: "string" },
        regex: { type: "string" },
        suggested: { type: "string" },
        runs: { type: "string" },
        "max-pages": { type: "string" },
        "max-depth": { type: "string" },
        "page-timeout": { type: "string" },
        "total-timeout": { type: "string" },
        delay: { type: "string" },
        "strict-readonly": { type: "boolean", default: false },
        "allow-page-writes": { type: "boolean", default: false },
        "ignore-robots": { type: "boolean", default: false },
        "no-session": { type: "boolean", default: false },
        "no-hidden": { type: "boolean", default: false },
        "max-cost": { type: "string" },
        model: { type: "string" },
        "mock-response": { type: "string" },
        saved: { type: "string" },
        save: { type: "string" },
        reuse: { type: "string" },
        search: { type: "string" },
        format: { type: "string" },
        sep: { type: "string" },
        out: { type: "string" },
        json: { type: "boolean", default: false },
        output: { type: "string", default: "./runs" },
        headed: { type: "boolean", default: false },
        "browser-channel": { type: "string" },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  const [first, ...extra] = positionals;
  const action: SearchAction = first === undefined ? "run" : (SEARCH_ACTIONS as readonly string[]).includes(first) ? (first as SearchAction) : "run";
  if (first !== undefined && action === "run" && first !== "run") throw new UsageError(`Unknown search action "${first}". Use: ${SEARCH_ACTIONS.join(", ")}.`);
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}".`);
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === false || (name === "output" && value === "./runs")) continue;
    if (!ALLOWED[action].includes(name)) throw new UsageError(`Option --${name} is not valid for "search ${action}".`);
  }
  const channel = values["browser-channel"] ?? "auto";
  if (!(BROWSER_CHANNELS as readonly string[]).includes(channel)) throw new UsageError(`--browser-channel must be one of ${BROWSER_CHANNELS.join(", ")}, got "${channel}".`);
  const browserChannel = channel as BrowserChannelArg;
  const int = (option: string, raw: string | undefined, min: number, max: number): number | undefined => {
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${option} must be an integer between ${min} and ${max}, got "${raw}".`);
    return n;
  };
  const usd = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > 100) throw new UsageError(`--max-cost must be a number of USD between 0 and 100, got "${raw}".`);
    return n;
  };
  const optional = <K extends string, V>(key: K, value: V | undefined) => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

  switch (action) {
    case "templates":
      return { kind: "search", action, json: values.json };
    case "suggest": {
      if (values.terms === undefined || values.terms.trim() === "") throw new UsageError('Missing required option --terms "a, b".');
      return { kind: "search", action, terms: values.terms, json: values.json, ...optional("model", values.model), ...optional("maxCostUsd", usd(values["max-cost"])), ...optional("mockResponse", values["mock-response"]) };
    }
    case "export": {
      if (values.search === undefined || values.search === "") throw new UsageError("Missing required option --search <id or directory>.");
      const format = values.format ?? "csv";
      if (format !== "csv" && format !== "pdf") throw new UsageError(`--format must be csv or pdf, got "${format}".`);
      const sep = values.sep === undefined || values.sep === ";" ? ";" : values.sep === "," ? "," : values.sep === "tab" || values.sep === "\t" ? "\t" : null;
      if (sep === null) throw new UsageError('--sep must be ";", "," or tab.');
      return { kind: "search", action, search: values.search, format, separator: sep, output: values.output, browserChannel, ...optional("out", values.out) };
    }
    case "run": {
      const saved = values.saved;
      const modes = [values.terms, values.meaning, values.template, values.regex].filter((v) => v !== undefined).length;
      if (saved === undefined) {
        if (values.url === undefined || values.url === "") throw new UsageError("Missing required option --url <site>.");
        if (values.meaning === undefined && values.template === undefined && values.terms === undefined && values.regex === undefined) {
          throw new UsageError('Say what to search: --terms "a, b", --meaning "<description>" or --template <id>.');
        }
        if (values.meaning !== undefined && (values.terms !== undefined || values.template !== undefined || values.regex !== undefined)) throw new UsageError("--meaning cannot be combined with --terms, --regex or --template.");
        if (values.template !== undefined && modes > 1) throw new UsageError("--template cannot be combined with --terms, --regex or --meaning.");
      }
      let url: string | undefined;
      if (values.url !== undefined) {
        try {
          const u = new URL(values.url);
          if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
          url = u.toString();
        } catch {
          throw new UsageError(`Invalid --url "${values.url}" (it must be an http or https address).`);
        }
      }
      const scope = values["exclude-scope"] ?? "block";
      if (scope !== "block" && scope !== "page") throw new UsageError('--exclude-scope must be "block" or "page".');
      return {
        kind: "search",
        action: "run",
        ...optional("url", url),
        ...optional("terms", values.terms),
        ...optional("meaning", values.meaning?.trim()),
        ...optional("template", values.template),
        withMeaning: values["with-meaning"],
        variants: values.variants,
        excludeScope: scope,
        ...optional("regex", values.regex),
        ...optional("suggested", values.suggested),
        ...optional("runs", int("runs", values.runs, 1, 20)),
        ...optional("maxPages", int("max-pages", values["max-pages"], 1, 500)),
        ...optional("maxDepth", int("max-depth", values["max-depth"], 0, 10)),
        ...optional("pageTimeoutMs", int("page-timeout", values["page-timeout"], 1_000, 300_000)),
        ...optional("totalTimeoutMs", int("total-timeout", values["total-timeout"], 10_000, 7_200_000)),
        ...optional("delayMs", int("delay", values.delay, 0, 60_000)),
        ...(values["strict-readonly"] ? { strictReadonly: true } : values["allow-page-writes"] ? { strictReadonly: false } : {}),
        ignoreRobots: values["ignore-robots"],
        noSession: values["no-session"],
        includeHidden: !values["no-hidden"],
        ...optional("maxCostUsd", usd(values["max-cost"])),
        ...optional("model", values.model),
        ...optional("mockResponse", values["mock-response"]),
        ...optional("saved", saved),
        ...optional("save", values.save?.trim() === "" ? undefined : values.save?.trim()),
        ...optional("reuse", values.reuse),
        output: values.output,
        headed: values.headed,
        browserChannel,
      };
    }
  }
}

export const SEARCH_HELP = `
  search      Search the text of a site (same crawl, limits, robots.txt, saved
              access and read-only mode as inspect). Output: runs/searches/<id>/.
                exegezis search --url <site> --terms "a, \\"a phrase\\", -excluded"
                    [--variants] [--exclude-scope block|page] [--regex <re>]
                exegezis search --url <site> --meaning "<what you look for>"
                    [--max-cost <USD>] [--model <id>]
                exegezis search --url <site> --template <id> [--with-meaning]
                exegezis search suggest --terms "a, b" [--json]
                exegezis search export --search <id|dir> --format csv|pdf [--sep ";"|","|tab]
                exegezis search templates [--json]
              Common: --max-pages 20 --max-depth 2 --runs 3 (1 by meaning)
              --no-session --no-hidden --save "<name>" --saved <id> --reuse <dir>.
              Exact: deterministic, accents and capitals ignored (ñ kept),
              whole words; VERIFIED in every load, INTERMITTENT otherwise.
              Meaning: the model proposes quotes; a quote that is not literally
              in the page is discarded and counted. Never VERIFIED. The cost is
              estimated first; above the limit (Settings, default 1 USD) the
              model is not called (exit 8).`;
