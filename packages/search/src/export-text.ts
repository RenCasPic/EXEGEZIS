import type { SearchHit } from "@exegezis/core";
import type { ReviewMark } from "./review.js";

/*
 * The words of the exports (CSV and the printable report) and of the CLI's
 * search summary, in English and Spanish (docs/11-i18n.md glossary). Quotes,
 * terms, URLs, selectors and the AI's reasons are never translated here: they
 * are the site's text or were already requested in the reader's language.
 */

export type ExportLocale = "en" | "es";

export const EXPORT_LOCALES: readonly ExportLocale[] = ["en", "es"];

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export interface ExportText {
  verdict: Record<SearchHit["verdict"], string>;
  via: Record<SearchHit["via"], string>;
  kind: Record<SearchHit["blockKind"], string>;
  review: Record<ReviewMark, string>;
  place: { metadata: string; attribute: string; attributeHidden: string; visible: string; hidden: string };
  relevance: Record<"high" | "medium" | "low", string>;
  template: (name: string, version: number, withoutAi: boolean) => string;
  stem: (stem: string) => string;
  csvHeader: string[];
  html: {
    title: (id: string) => string;
    heading: (url: string) => string;
    searched: (searched: number, found: number) => string;
    skippedBudget: (count: number) => string;
    skippedRobots: (count: number) => string;
    skippedSafety: (count: number) => string;
    blocked: (list: string) => string;
    failed: (count: number) => string;
    summary: (hits: number, verified: number, intermittent: number, suggested: number) => string;
    discarded: (count: number) => string;
    excluded: (term: string, wholePage: boolean, hits: number, blocks: number, pages: number) => string;
    ai: (model: string, calls: number, tokens: number, cost: string, estimate: string, limit: string) => string;
    aiCaveat: string;
    noHits: (searched: number) => string;
    byVariant: (stem: string) => string;
    reason: (relevance: string) => string;
    open: string;
    loads: (seen: number, runs: number) => string;
  };
}

export const EXPORT_TEXT: Record<ExportLocale, ExportText> = {
  en: {
    verdict: { VERIFIED: "Verified", INTERMITTENT: "Intermittent", SUGGESTED_QUOTE_VERIFIED: "Suggestion · verified quote" },
    via: { exact: "exact", variant: "by variant", regex: "regular expression", detector: "detector", meaning: "by meaning (AI)" },
    kind: {
      heading: "heading",
      paragraph: "paragraph",
      "list-item": "list item",
      cell: "cell",
      button: "button",
      link: "link",
      label: "label",
      quote: "quote",
      text: "text",
      alt: "alternative text (alt)",
      "title-attr": "title attribute",
      "aria-label": "aria-label",
      "meta-title": "page title",
      "meta-description": "meta description",
      og: "Open Graph",
    },
    review: { relevant: "Relevant", "not-relevant": "Not relevant", pending: "Pending" },
    place: { metadata: "in metadata", attribute: "in an attribute", attributeHidden: "in an attribute, not visible", visible: "visible", hidden: "not visible" },
    relevance: { high: "high", medium: "medium", low: "low" },
    template: (name, version, withoutAi) => `Template “${name}” v${version}${withoutAi ? " (no AI)" : ""}`,
    stem: (stem) => `, stem “${stem}”`,
    csvHeader: ["Page", "Type", "Term", "Quote", "Context before", "Context after", "Where", "Block", "Selector", "Loads", "Reason (AI)", "Relevance (AI)", "Review", "Link to the phrase"],
    html: {
      title: (id) => `Search ${id}`,
      heading: (url) => `Search in ${url}`,
      searched: (searched, found) => `${searched} of ${n(found, "page", "pages")} found were searched.`,
      skippedBudget: (c) => ` ${c} beyond the page limit.`,
      skippedRobots: (c) => ` ${c} excluded by robots.txt.`,
      skippedSafety: (c) => ` ${n(c, "link", "links")} skipped for safety.`,
      blocked: (list) => ` Blocked: ${list}.`,
      failed: (c) => ` ${c} did not respond.`,
      summary: (hits, verified, intermittent, suggested) => `${n(hits, "result", "results")}: ${verified} verified, ${intermittent} intermittent, ${n(suggested, "suggestion", "suggestions")} with a verified quote`,
      discarded: (c) => `; ${n(c, "AI quote", "AI quotes")} discarded for not appearing on the page`,
      excluded: (term, wholePage, hits, blocks, pages) => `Excluded by “${term}” (${wholePage ? "page" : "block"}): ${n(hits, "result", "results")} in ${n(blocks, "block", "blocks")} of ${n(pages, "page", "pages")}.`,
      ai: (model, calls, tokens, cost, estimate, limit) => `AI: ${model} · ${n(calls, "call", "calls")} · ${tokens} tokens · ${cost} USD (estimated ${estimate}, limit ${limit})`,
      aiCaveat: "Meaning search may not find everything.",
      noHits: (searched) => `0 matches in ${n(searched, "page", "pages")} searched.`,
      byVariant: (stem) => `by variant (stem “${stem}”)`,
      reason: (relevance) => `Reason (AI, ${relevance})`,
      open: "Open on the page",
      loads: (seen, runs) => `${seen}/${runs} loads`,
    },
  },
  es: {
    verdict: { VERIFIED: "Verificado", INTERMITTENT: "Intermitente", SUGGESTED_QUOTE_VERIFIED: "Sugerencia · cita verificada" },
    via: { exact: "exacta", variant: "por variante", regex: "expresión regular", detector: "detector", meaning: "por significado (IA)" },
    kind: {
      heading: "título",
      paragraph: "párrafo",
      "list-item": "elemento de lista",
      cell: "celda",
      button: "botón",
      link: "enlace",
      label: "etiqueta",
      quote: "cita",
      text: "texto",
      alt: "texto alternativo (alt)",
      "title-attr": "atributo title",
      "aria-label": "aria-label",
      "meta-title": "título de la página",
      "meta-description": "meta description",
      og: "Open Graph",
    },
    review: { relevant: "Relevante", "not-relevant": "No relevante", pending: "Pendiente" },
    place: { metadata: "en metadatos", attribute: "en atributo", attributeHidden: "en atributo, no visible", visible: "visible", hidden: "no visible" },
    relevance: { high: "alta", medium: "media", low: "baja" },
    template: (name, version, withoutAi) => `Plantilla «${name}» v${version}${withoutAi ? " (sin IA)" : ""}`,
    stem: (stem) => `, raíz «${stem}»`,
    csvHeader: ["Página", "Tipo", "Término", "Cita", "Contexto antes", "Contexto después", "Dónde", "Bloque", "Selector", "Repeticiones", "Motivo (IA)", "Relevancia (IA)", "Revisión", "Enlace a la frase"],
    html: {
      title: (id) => `Búsqueda ${id}`,
      heading: (url) => `Búsqueda en ${url}`,
      searched: (searched, found) => `Se revisaron ${searched} de ${n(found, "página encontrada", "páginas encontradas")}.`,
      skippedBudget: (c) => ` ${c} fuera del límite de páginas.`,
      skippedRobots: (c) => ` ${c} excluidas por robots.txt.`,
      skippedSafety: (c) => ` ${n(c, "enlace omitido", "enlaces omitidos")} por seguridad.`,
      blocked: (list) => ` Bloqueadas: ${list}.`,
      failed: (c) => ` ${c} no respondieron.`,
      summary: (hits, verified, intermittent, suggested) =>
        `${n(hits, "resultado", "resultados")}: ${n(verified, "verificado", "verificados")}, ${n(intermittent, "intermitente", "intermitentes")}, ${n(suggested, "sugerencia", "sugerencias")} con cita verificada`,
      discarded: (c) => `; ${n(c, "cita de la IA descartada", "citas de la IA descartadas")} por no aparecer en la página`,
      excluded: (term, wholePage, hits, blocks, pages) => `Excluidos por «${term}» (${wholePage ? "página" : "bloque"}): ${n(hits, "resultado", "resultados")} en ${n(blocks, "bloque", "bloques")} de ${n(pages, "página", "páginas")}.`,
      ai: (model, calls, tokens, cost, estimate, limit) => `IA: ${model} · ${n(calls, "llamada", "llamadas")} · ${tokens} tokens · ${cost} USD (estimado ${estimate}, límite ${limit})`,
      aiCaveat: "La búsqueda por significado puede no encontrarlo todo.",
      noHits: (searched) => `0 coincidencias en ${n(searched, "página revisada", "páginas revisadas")}.`,
      byVariant: (stem) => `por variante (raíz «${stem}»)`,
      reason: (relevance) => `Motivo (IA, ${relevance})`,
      open: "Abrir en la página",
      loads: (seen, runs) => `${seen}/${runs} cargas`,
    },
  },
};

export function isExportLocale(v: unknown): v is ExportLocale {
  return v === "en" || v === "es";
}
