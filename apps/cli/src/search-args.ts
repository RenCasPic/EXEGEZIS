import { parseArgs } from "node:util";
import { BROWSER_CHANNELS, parseArgsError, UsageError, type BrowserChannelArg } from "./args.js";
import { t } from "./i18n.js";

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
  /** Pages visited at the same time (1-3). */
  concurrency?: number;
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
    "url", "terms", "meaning", "template", "with-meaning", "variants", "exclude-scope", "regex", "suggested", "runs", "max-pages", "max-depth", "page-timeout", "total-timeout", "delay", "concurrency",
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
        concurrency: { type: "string" },
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
    throw parseArgsError(error);
  }
  const { values, positionals } = parsed;
  const [first, ...extra] = positionals;
  const action: SearchAction = first === undefined ? "run" : (SEARCH_ACTIONS as readonly string[]).includes(first) ? (first as SearchAction) : "run";
  if (first !== undefined && action === "run" && first !== "run") throw new UsageError(t("search.args.unknownAction", { action: first, actions: SEARCH_ACTIONS.join(", ") }));
  if (extra.length > 0) throw new UsageError(t("args.unexpected", { arg: String(extra[0]) }));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === false || (name === "output" && value === "./runs")) continue;
    if (!ALLOWED[action].includes(name)) throw new UsageError(t("args.notValidFor", { option: name, command: `search ${action}` }));
  }
  const channel = values["browser-channel"] ?? "auto";
  if (!(BROWSER_CHANNELS as readonly string[]).includes(channel)) throw new UsageError(t("args.oneOf", { option: "--browser-channel", values: BROWSER_CHANNELS.join(", "), value: channel }));
  const browserChannel = channel as BrowserChannelArg;
  const int = (option: string, raw: string | undefined, min: number, max: number): number | undefined => {
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(t("args.intRange", { option, min: String(min), max: String(max), value: raw }));
    return n;
  };
  const usd = (raw: string | undefined): number | undefined => {
    if (raw === undefined) return undefined;
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0 || n > 100) throw new UsageError(t("search.args.maxCost", { value: raw }));
    return n;
  };
  const optional = <K extends string, V>(key: K, value: V | undefined) => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

  switch (action) {
    case "templates":
      return { kind: "search", action, json: values.json };
    case "suggest": {
      if (values.terms === undefined || values.terms.trim() === "") throw new UsageError(t("args.missing", { option: '--terms "a, b"' }));
      return { kind: "search", action, terms: values.terms, json: values.json, ...optional("model", values.model), ...optional("maxCostUsd", usd(values["max-cost"])), ...optional("mockResponse", values["mock-response"]) };
    }
    case "export": {
      if (values.search === undefined || values.search === "") throw new UsageError(t("args.missing", { option: "--search <id|dir>" }));
      const format = values.format ?? "csv";
      if (format !== "csv" && format !== "pdf") throw new UsageError(t("search.args.format", { value: format }));
      const sep = values.sep === undefined || values.sep === ";" ? ";" : values.sep === "," ? "," : values.sep === "tab" || values.sep === "\t" ? "\t" : null;
      if (sep === null) throw new UsageError(t("search.args.sep"));
      return { kind: "search", action, search: values.search, format, separator: sep, output: values.output, browserChannel, ...optional("out", values.out) };
    }
    case "run": {
      const saved = values.saved;
      const modes = [values.terms, values.meaning, values.template, values.regex].filter((v) => v !== undefined).length;
      if (saved === undefined) {
        if (values.url === undefined || values.url === "") throw new UsageError(t("args.missing", { option: "--url <site>" }));
        if (values.meaning === undefined && values.template === undefined && values.terms === undefined && values.regex === undefined) {
          throw new UsageError(t("search.args.what"));
        }
        if (values.meaning !== undefined && (values.terms !== undefined || values.template !== undefined || values.regex !== undefined)) throw new UsageError(t("search.args.meaningAlone"));
        if (values.template !== undefined && modes > 1) throw new UsageError(t("search.args.templateAlone"));
      }
      let url: string | undefined;
      if (values.url !== undefined) {
        try {
          const u = new URL(values.url);
          if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
          url = u.toString();
        } catch {
          throw new UsageError(t("search.args.url", { value: values.url }));
        }
      }
      const scope = values["exclude-scope"] ?? "block";
      if (scope !== "block" && scope !== "page") throw new UsageError(t("search.args.scope"));
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
        ...optional("concurrency", int("concurrency", values.concurrency, 1, 3)),
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
