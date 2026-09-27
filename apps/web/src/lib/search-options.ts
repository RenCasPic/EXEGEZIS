import { SuggestedTerm } from "@exegezis/core";
import type { z } from "zod";
import type { StartSearchInput } from "./jobs";

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

const int = (raw: string, min: number, max: number, label: string): number | null | string => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : `${label}: un número entero entre ${min} y ${max}.`;
};

export function parseSearchForm(f: SearchFormFields): { ok: true; input: StartSearchInput } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(f.url.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol");
  } catch {
    return { ok: false, error: "Escribe una URL que empiece por http:// o https://." };
  }
  const mode = f.mode === "meaning" || f.mode === "template" ? f.mode : "exact";
  if (mode === "exact" && f.terms.trim() === "") return { ok: false, error: "Escribe al menos un término (separa varios con comas)." };
  if (mode === "exact" && f.terms.replace(/(^|,)\s*-[^,]*/g, "").replace(/[,\s"“”«»]/g, "") === "") {
    return { ok: false, error: "Solo hay exclusiones (-palabra): añade algo que buscar." };
  }
  if (mode === "meaning" && f.meaning.trim().length < 3) return { ok: false, error: "Describe qué buscas (por ejemplo: «cualquier mención a la medicina, directa o indirecta»)." };
  if (mode === "template" && !/^[a-z0-9][a-z0-9-]{1,60}$/.test(f.template)) return { ok: false, error: "Elige una plantilla." };
  let suggested: z.infer<typeof SuggestedTerm>[] = [];
  if (f.suggested.trim() !== "") {
    let raw: unknown;
    try {
      raw = JSON.parse(f.suggested);
    } catch {
      return { ok: false, error: "Los términos sugeridos no son válidos." };
    }
    const parsed = SuggestedTerm.array().max(50).safeParse(raw);
    if (!parsed.success) return { ok: false, error: "Los términos sugeridos no son válidos." };
    suggested = parsed.data;
  }
  const runs = int(f.runs, 1, 20, "Cargas por página");
  const maxPages = int(f.maxPages, 1, 500, "Páginas");
  const maxDepth = int(f.maxDepth, 0, 10, "Profundidad");
  for (const v of [runs, maxPages, maxDepth]) if (typeof v === "string") return { ok: false, error: v };
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
