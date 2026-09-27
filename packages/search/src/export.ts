import { queryParts, type SearchHit, type SearchReport } from "@exegezis/core";
import { describeExact } from "./query.js";
import { markOf, REVIEW_LABEL, type ReviewFile } from "./review.js";

/*
 * Exports (docs/10-search.md §5): CSV that Excel opens with its accents
 * (UTF-8 with BOM, CRLF, «;» by default for a Spanish Excel), and a
 * standalone HTML page that the CLI prints to PDF with Chromium.
 */

export const VERDICT_LABEL: Record<SearchHit["verdict"], string> = {
  VERIFIED: "Verificado",
  INTERMITTENT: "Intermitente",
  SUGGESTED_QUOTE_VERIFIED: "Sugerencia · cita verificada",
};

export const VIA_LABEL: Record<SearchHit["via"], string> = {
  exact: "exacta",
  variant: "por variante",
  regex: "expresión regular",
  detector: "detector",
  meaning: "por significado (IA)",
};

export const KIND_LABEL: Record<SearchHit["blockKind"], string> = {
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
};

/** Where a hit sits, in words: visible, not visible, in an attribute, in the metadata. */
export function placeLabel(h: Pick<SearchHit, "blockKind" | "visible">): string {
  if (h.blockKind === "meta-title" || h.blockKind === "meta-description" || h.blockKind === "og") return "en metadatos";
  if (h.blockKind === "alt" || h.blockKind === "title-attr" || h.blockKind === "aria-label") return h.visible ? "en atributo" : "en atributo, no visible";
  return h.visible ? "visible" : "no visible";
}

export function describeQuery(report: Pick<SearchReport, "query">): string {
  const q = report.query;
  if (q.kind === "exact") return describeExact(q);
  if (q.kind === "meaning") return q.description;
  const parts = queryParts(q);
  return `Plantilla «${q.name}» v${q.version}${parts.meaning === null ? " (sin IA)" : ""}`;
}

function csvField(value: string, sep: string): string {
  return /["\r\n]/.test(value) || value.includes(sep) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(report: SearchReport, review: ReviewFile, sep: ";" | "," | "\t" = ";"): string {
  const header = ["Página", "Tipo", "Término", "Cita", "Contexto antes", "Contexto después", "Dónde", "Bloque", "Selector", "Repeticiones", "Motivo (IA)", "Relevancia (IA)", "Revisión", "Enlace a la frase"];
  const rows = report.hits.map((h) => [
    h.page,
    `${VERDICT_LABEL[h.verdict]} (${VIA_LABEL[h.via]}${h.stem === null ? "" : `, raíz «${h.stem}»`})`,
    h.term ?? "",
    h.quote,
    h.contextBefore,
    h.contextAfter,
    placeLabel(h),
    KIND_LABEL[h.blockKind],
    h.selector ?? "",
    h.source === "meaning" ? "—" : `${h.occurrences.length}/${report.options.runs}`,
    h.reason ?? "",
    h.relevance ?? "",
    REVIEW_LABEL[markOf(review, h)],
    h.textFragmentUrl,
  ]);
  return `\uFEFF${[header, ...rows].map((r) => r.map((f) => csvField(f, sep)).join(sep)).join("\r\n")}\r\n`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function quoteHtml(h: SearchHit): string {
  return `${esc(h.contextBefore)}<strong>${esc(h.quote.slice(0, h.match.start))}<mark>${esc(h.quote.slice(h.match.start, h.match.end))}</mark>${esc(h.quote.slice(h.match.end))}</strong>${esc(h.contextAfter)}`;
}

/** A printable report (Spanish), the same facts as the web detail. */
export function renderReportHtml(report: SearchReport, review: ReviewFile): string {
  const c = report.coverage;
  const byPage = new Map<string, SearchHit[]>();
  for (const h of report.hits) byPage.set(h.page, [...(byPage.get(h.page) ?? []), h]);
  const ai = report.ai;
  const blocked = c.blocked.map((b) => `${esc(b.url)} (${esc(b.kind)})`).join(", ");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Búsqueda ${esc(report.id)}</title>
<style>
body{font:12px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:24px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:18px 0 6px;word-break:break-all}
.muted{color:#555}.box{border:1px solid #ccc;border-radius:6px;padding:8px 10px;margin:10px 0}
.hit{border-top:1px solid #ddd;padding:6px 0;break-inside:avoid}
.tag{display:inline-block;border:1px solid #999;border-radius:9px;padding:0 6px;font-size:10px;margin-right:4px}
mark{background:#ffe066}a{color:#0645ad;word-break:break-all}
</style></head><body>
<h1>Búsqueda en ${esc(report.target.url)}</h1>
<div class="muted">${esc(describeQuery(report))} · ${esc(report.finishedAt.slice(0, 16).replace("T", " "))} UTC · ${esc(report.id)}</div>
<div class="box"><strong>Se revisaron ${c.searched} de ${c.found} páginas encontradas.</strong>
${c.skippedBudget > 0 ? ` ${c.skippedBudget} fuera del límite de páginas.` : ""}${c.skippedRobots > 0 ? ` ${c.skippedRobots} excluidas por robots.txt.` : ""}${c.skippedSafety > 0 ? ` ${c.skippedSafety} enlaces omitidos por seguridad.` : ""}${blocked !== "" ? ` Bloqueadas: ${blocked}.` : ""}${c.failed > 0 ? ` ${c.failed} no respondieron.` : ""}
<br>${report.summary.hits} resultados: ${report.summary.verified} verificados, ${report.summary.intermittent} intermitentes, ${report.summary.suggested} sugerencias con cita verificada${report.summary.discardedQuotes > 0 ? `; ${report.summary.discardedQuotes} citas de la IA descartadas por no aparecer en la página` : ""}.
${report.excluded.map((e) => `<br>Excluidos por «${esc(e.term)}» (${e.scope === "block" ? "bloque" : "página"}): ${e.hits} resultados en ${e.blocks} bloques de ${e.pages} páginas.`).join("")}
${ai === null ? "" : `<br>IA: ${esc(ai.model)} · ${ai.calls} llamadas · ${ai.inputTokens + ai.outputTokens} tokens · ${ai.costUsd.toFixed(4)} USD (estimado ${ai.estimateUsd.toFixed(2)}, límite ${ai.maxCostUsd.toFixed(2)})${ai.error === null ? "" : ` · ${esc(ai.error)}`}. La búsqueda por significado puede no encontrarlo todo.`}
</div>
${report.hits.length === 0 ? `<p>0 coincidencias en ${c.searched} páginas revisadas.</p>` : ""}
${[...byPage.entries()]
  .map(
    ([page, hits]) => `<h2>${esc(page)} (${hits.length})</h2>${hits
      .map(
        (h) => `<div class="hit"><span class="tag">${esc(VERDICT_LABEL[h.verdict])}</span><span class="tag">${esc(placeLabel(h))}</span>${h.via === "variant" ? `<span class="tag">por variante (raíz «${esc(h.stem ?? "")}»)</span>` : ""}<span class="tag">${esc(REVIEW_LABEL[markOf(review, h)])}</span>${h.term === null ? "" : ` <span class="muted">${esc(h.term)}</span>`}
<div>${quoteHtml(h)}</div>${h.reason === null ? "" : `<div class="muted">Motivo (IA, ${esc(h.relevance ?? "")}): ${esc(h.reason)}</div>`}<div><a href="${esc(h.textFragmentUrl)}">Abrir en la página</a> · ${esc(KIND_LABEL[h.blockKind])}${h.source === "exact" ? ` · ${h.occurrences.length}/${report.options.runs} cargas` : ""}</div></div>`,
      )
      .join("")}`,
  )
  .join("")}
</body></html>`;
}
