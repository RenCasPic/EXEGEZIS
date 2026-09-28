import { queryParts, type SearchHit, type SearchReport } from "@exegezis/core";
import { describeExact } from "./query.js";
import { EXPORT_TEXT, type ExportLocale } from "./export-text.js";
import { markOf, type ReviewFile } from "./review.js";

/*
 * Exports (docs/10-search.md §5): CSV that Excel opens with its accents
 * (UTF-8 with BOM, CRLF, «;» by default for a Spanish Excel), and a
 * standalone HTML page that the CLI prints to PDF with Chromium. Both in the
 * reader's language (export-text.ts).
 */

/** Spanish labels, kept for older callers; new code uses EXPORT_TEXT[locale]. */
export const VERDICT_LABEL = EXPORT_TEXT.es.verdict;
export const VIA_LABEL = EXPORT_TEXT.es.via;
export const KIND_LABEL = EXPORT_TEXT.es.kind;

/** Where a hit sits, in words: visible, not visible, in an attribute, in the metadata. */
export function placeLabel(h: Pick<SearchHit, "blockKind" | "visible">, locale: ExportLocale = "es"): string {
  const p = EXPORT_TEXT[locale].place;
  if (h.blockKind === "meta-title" || h.blockKind === "meta-description" || h.blockKind === "og") return p.metadata;
  if (h.blockKind === "alt" || h.blockKind === "title-attr" || h.blockKind === "aria-label") return h.visible ? p.attribute : p.attributeHidden;
  return h.visible ? p.visible : p.hidden;
}

export function describeQuery(report: Pick<SearchReport, "query">, locale: ExportLocale = "es"): string {
  const q = report.query;
  if (q.kind === "exact") return describeExact(q);
  if (q.kind === "meaning") return q.description;
  return EXPORT_TEXT[locale].template(q.name, q.version, queryParts(q).meaning === null);
}

function csvField(value: string, sep: string): string {
  return /["\r\n]/.test(value) || value.includes(sep) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(report: SearchReport, review: ReviewFile, sep: ";" | "," | "\t" = ";", locale: ExportLocale = "es"): string {
  const x = EXPORT_TEXT[locale];
  const rows = report.hits.map((h) => [
    h.page,
    `${x.verdict[h.verdict]} (${x.via[h.via]}${h.stem === null ? "" : x.stem(h.stem)})`,
    h.term ?? "",
    h.quote,
    h.contextBefore,
    h.contextAfter,
    placeLabel(h, locale),
    x.kind[h.blockKind],
    h.selector ?? "",
    h.source === "meaning" ? "—" : `${h.occurrences.length}/${report.options.runs}`,
    h.reason ?? "",
    h.relevance === null ? "" : x.relevance[h.relevance],
    x.review[markOf(review, h)],
    h.textFragmentUrl,
  ]);
  return `\uFEFF${[x.csvHeader, ...rows].map((r) => r.map((f) => csvField(f, sep)).join(sep)).join("\r\n")}\r\n`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function quoteHtml(h: SearchHit): string {
  return `${esc(h.contextBefore)}<strong>${esc(h.quote.slice(0, h.match.start))}<mark>${esc(h.quote.slice(h.match.start, h.match.end))}</mark>${esc(h.quote.slice(h.match.end))}</strong>${esc(h.contextAfter)}`;
}

/** A printable report in the reader's language: the same facts as the web detail. */
export function renderReportHtml(report: SearchReport, review: ReviewFile, locale: ExportLocale = "es"): string {
  const x = EXPORT_TEXT[locale];
  const t = x.html;
  const c = report.coverage;
  const s = report.summary;
  const byPage = new Map<string, SearchHit[]>();
  for (const h of report.hits) byPage.set(h.page, [...(byPage.get(h.page) ?? []), h]);
  const ai = report.ai;
  const blocked = c.blocked.map((b) => `${esc(b.url)} (${esc(b.kind)})`).join(", ");
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${esc(t.title(report.id))}</title>
<style>
body{font:12px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#111;margin:24px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:18px 0 6px;word-break:break-all}
.muted{color:#555}.box{border:1px solid #ccc;border-radius:6px;padding:8px 10px;margin:10px 0}
.hit{border-top:1px solid #ddd;padding:6px 0;break-inside:avoid}
.tag{display:inline-block;border:1px solid #999;border-radius:9px;padding:0 6px;font-size:10px;margin-right:4px}
mark{background:#ffe066}a{color:#0645ad;word-break:break-all}
</style></head><body>
<h1>${esc(t.heading(report.target.url))}</h1>
<div class="muted">${esc(describeQuery(report, locale))} · ${esc(report.finishedAt.slice(0, 16).replace("T", " "))} UTC · ${esc(report.id)}</div>
<div class="box"><strong>${esc(t.searched(c.searched, c.found))}</strong>
${c.skippedBudget > 0 ? esc(t.skippedBudget(c.skippedBudget)) : ""}${c.skippedRobots > 0 ? esc(t.skippedRobots(c.skippedRobots)) : ""}${c.skippedSafety > 0 ? esc(t.skippedSafety(c.skippedSafety)) : ""}${blocked !== "" ? t.blocked(blocked) : ""}${c.failed > 0 ? esc(t.failed(c.failed)) : ""}
<br>${esc(t.summary(s.hits, s.verified, s.intermittent, s.suggested))}${s.discardedQuotes > 0 ? esc(t.discarded(s.discardedQuotes)) : ""}.
${report.excluded.map((e) => `<br>${esc(t.excluded(e.term, e.scope !== "block", e.hits, e.blocks, e.pages))}`).join("")}
${ai === null ? "" : `<br>${esc(t.ai(ai.model, ai.calls, ai.inputTokens + ai.outputTokens, ai.costUsd.toFixed(4), ai.estimateUsd.toFixed(2), ai.maxCostUsd.toFixed(2)))}${ai.error === null ? "" : ` · ${esc(ai.error)}`}. ${esc(t.aiCaveat)}`}
</div>
${report.hits.length === 0 ? `<p>${esc(t.noHits(c.searched))}</p>` : ""}
${[...byPage.entries()]
  .map(
    ([page, hits]) => `<h2>${esc(page)} (${hits.length})</h2>${hits
      .map(
        (h) => `<div class="hit"><span class="tag">${esc(x.verdict[h.verdict])}</span><span class="tag">${esc(placeLabel(h, locale))}</span>${h.via === "variant" ? `<span class="tag">${esc(t.byVariant(h.stem ?? ""))}</span>` : ""}<span class="tag">${esc(x.review[markOf(review, h)])}</span>${h.term === null ? "" : ` <span class="muted">${esc(h.term)}</span>`}
<div>${quoteHtml(h)}</div>${h.reason === null ? "" : `<div class="muted">${esc(t.reason(h.relevance === null ? "" : x.relevance[h.relevance]))}: ${esc(h.reason)}</div>`}<div><a href="${esc(h.textFragmentUrl)}">${esc(t.open)}</a> · ${esc(x.kind[h.blockKind])}${h.source === "exact" ? ` · ${esc(t.loads(h.occurrences.length, report.options.runs))}` : ""}</div></div>`,
      )
      .join("")}`,
  )
  .join("")}
</body></html>`;
}
