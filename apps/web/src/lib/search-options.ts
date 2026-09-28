import { SuggestedTerm } from "@exegezis/core";
import type { z } from "zod";
import type { StartSearchInput } from "./jobs";
import { ui, type UiMessage } from "./ui-message";

/*
 * The search form (home, «Buscar»), validated on the server before a job is
 * created. Pure, so it is tested without a server.
 */

export { SEARCH_DEFAULTS } from "./search-defaults";

export interface SearchFormFields {
  url: string;
  mode: string;
  terms: string;
  meaning: string;
  template: string;
  withMeaning: boolean;
  variants: boolean;
  excludeScope: string;
  suggested: string;
  runs: string;
  maxPages: string;
  maxDepth: string;
  includeHidden: boolean;
  noSession: boolean;
  ignoreRobots: boolean;
  browserChannel: string;
  save: string;
}

const int = (raw: string, min: number, max: number, key: string): number | null | UiMessage => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : ui(key, { min, max });
};

export function parseSearchForm(f: SearchFormFields): { ok: true; input: StartSearchInput } | { ok: false; error: UiMessage } {
  let url: URL;
  try {
    url = new URL(f.url.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
  } catch {
    return { ok: false, error: ui("common.errors.searchUrl") };
  }
  const mode = f.mode === "meaning" || f.mode === "template" ? f.mode : "exact";
  if (mode === "exact" && f.terms.trim() === "") return { ok: false, error: ui("common.errors.searchTerms") };
  if (mode === "exact" && f.terms.replace(/(^|,)\s*-[^,]*/g, "").replace(/[,\s"“”«»]/g, "") === "") {
    return { ok: false, error: ui("common.errors.onlyExclusions") };
  }
  if (mode === "meaning" && f.meaning.trim().length < 3) return { ok: false, error: ui("common.errors.meaningShort") };
  if (mode === "template" && !/^[a-z0-9][a-z0-9-]{1,60}$/.test(f.template)) return { ok: false, error: ui("common.errors.chooseTemplate") };
  let suggested: z.infer<typeof SuggestedTerm>[] = [];
  if (f.suggested.trim() !== "") {
    let raw: unknown;
    try {
      raw = JSON.parse(f.suggested);
    } catch {
      return { ok: false, error: ui("common.errors.suggestedInvalid") };
    }
    const parsed = SuggestedTerm.array().max(50).safeParse(raw);
    if (!parsed.success) return { ok: false, error: ui("common.errors.suggestedInvalid") };
    suggested = parsed.data;
  }
  const runs = int(f.runs, 1, 20, "common.errors.loadsRange");
  const maxPages = int(f.maxPages, 1, 500, "common.errors.pagesRange");
  const maxDepth = int(f.maxDepth, 0, 10, "common.errors.depthRange");
  for (const v of [runs, maxPages, maxDepth]) if (typeof v === "object" && v !== null) return { ok: false, error: v };
  const channel = ["auto", "chromium", "chrome", "msedge"].includes(f.browserChannel) ? (f.browserChannel as StartSearchInput["browserChannel"]) : "auto";
  return {
    ok: true,
    input: {
      url: url.toString(),
      mode,
      terms: mode === "exact" ? f.terms.trim() : null,
      meaning: mode === "meaning" ? f.meaning.trim() : null,
      template: mode === "template" ? f.template : null,
      withMeaning: mode === "template" && f.withMeaning,
      variants: mode === "exact" && f.variants,
      excludeScope: f.excludeScope === "page" ? "page" : "block",
      suggested: mode === "exact" ? suggested : [],
      runs: runs as number | null,
      maxPages: maxPages as number | null,
      maxDepth: maxDepth as number | null,
      includeHidden: f.includeHidden,
      noSession: f.noSession,
      ignoreRobots: f.ignoreRobots,
      browserChannel: channel,
      maxCostUsd: null,
      saved: null,
      save: f.save.trim() === "" ? null : f.save.trim().slice(0, 200),
      reuse: null,
    },
  };
}
