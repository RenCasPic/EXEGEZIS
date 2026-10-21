import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { groupStats, INSPECTABLE, medianRange, organizeGroups, rate, zoneOfGroup, type Finding, type InspectionReport, type IssueGroup, type Severity } from "@exegezis/core";
import { createTranslator } from "next-intl";
import { CATALOGS } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { shortUrl } from "@/lib/inspection-labels";
import { groupTitle, type InspectionsT } from "@/lib/issue-labels";
import { PRINT } from "@/lib/report-theme";
import { isInside } from "@/lib/workspace";

/*
 * The owner's report: what a site owner (not a developer) needs from an
 * inspection, printable to PDF (`exegezis pdf`). Only VERIFIED problems (seen
 * in every run), by Frontend / Backend and severity, each with its evidence
 * (a screenshot, the steps, N of N runs) and how to fix it; a plain summary
 * first, and the note that the review was passive and of public pages only.
 * Self-contained: styles inline, screenshots as data: URLs, no script.
 */

type T = (key: string, values?: Record<string, string | number>) => string;

const SEVERITY_ORDER: Severity[] = ["critical", "serious", "moderate", "minor"];
/** Groups with their screenshot embedded; the rest are listed without it (a PDF of reasonable size). */
const MAX_SHOTS = 24;
const MAX_SHOT_BYTES = 1_500_000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function translators(locale: Locale): { t: T; ti: InspectionsT; tl: T } {
  const messages = CATALOGS[locale] as never;
  const make = (namespace: string) => createTranslator({ locale, messages, namespace: namespace as never }) as unknown as T;
  return { t: make("report"), ti: make("inspections"), tl: make("labels") };
}

/** The rule of a finding, from its fingerprint: "security-headers:csp-missing" → "csp-missing". */
function ruleOf(f: Finding): string {
  const rest = f.fingerprint.slice(f.fingerprint.indexOf(":") + 1);
  return rest.split(" ")[0] ?? "";
}

async function screenshot(dir: string, f: Finding | undefined): Promise<string | null> {
  if (f === undefined) return null;
  const shot = f.evidence.find((e) => e.kind === "screenshot" && e.path.endsWith("axe-highlight.png")) ?? f.evidence.find((e) => e.kind === "screenshot");
  if (shot === undefined) return null;
  const file = join(dir, shot.path);
  if (!isInside(dir, file)) return null;
  try {
    if ((await stat(file)).size > MAX_SHOT_BYTES) return null;
    const type = extname(file).toLowerCase() === ".jpg" ? "image/jpeg" : "image/png";
    return `data:${type};base64,${(await readFile(file)).toString("base64")}`;
  } catch {
    return null;
  }
}

function recommendation(t: T, locale: Locale, g: IssueGroup, first: Finding): string {
  if (g.contrast !== null) {
    return g.contrast.suggestion === null ? t("fix.contrast", { required: g.contrast.required }) : t("fix.contrastColor", { color: g.contrast.suggestion.color.toUpperCase(), ratio: g.contrast.suggestion.ratio, required: g.contrast.required });
  }
  if (g.tapTarget !== null) return t("fix.tap", { x: g.tapTarget.padding.x, y: g.tapTarget.padding.y });
  const rule = ruleOf(first);
  const fixes = ((CATALOGS[locale] as { report?: { fix?: Record<string, unknown> } }).report?.fix ?? {});
  const ofCheck = fixes[g.checkId];
  if (typeof ofCheck === "object" && ofCheck !== null && typeof (ofCheck as Record<string, unknown>)[rule] === "string") return t(`fix.${g.checkId}.${rule}`);
  if (g.checkId === "a11y") {
    const help = /Rule: (\S+)/.exec(first.detail)?.[1];
    return t("fix.a11y", { rule: g.rule ?? rule, link: help ?? "https://dequeuniversity.com/rules/axe/" });
  }
  return typeof ofCheck === "string" ? t(`fix.${g.checkId}`) : t("fix.generic");
}

function devicesText(t: T, f: Finding): string {
  const verified = f.devices.filter((d) => d.verdict === "VERIFIED").map((d) => t(`device.${d.device}`));
  return verified.join(` ${t("and")} `);
}

export interface OwnerReportInput {
  report: InspectionReport;
  /** The inspection's directory (screenshots are read from it). */
  dir: string;
  id: string;
  locale: Locale;
}

/** The owner's report as one self-contained HTML document. */
export async function ownerReportHtml({ report, dir, id, locale }: OwnerReportInput): Promise<string> {
  const { t, ti, tl } = translators(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(new Date(report.finishedAt));
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  const problems = report.groups.filter((g) => g.verified > 0 && g.severity !== "info");
  const stats = groupStats(report.groups, report.findings);
  const pages = new Set(report.pages.filter((p) => INSPECTABLE.includes(p.status)).map((p) => p.url)).size;
  const devices = report.options.devices.map((d) => t(`device.${d}`)).join(` ${t("and")} `);
  const areas = organizeGroups(problems, report.findings);
  const runs = report.options.runs;
  const sev = (s: Severity) => tl(`severity.${s}`);

  // Executive summary: the three most important problems, in plain words.
  const top = [...problems].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.elements - a.elements).slice(0, 3);
  const summary = `
    <section aria-labelledby="summary">
      <h2 id="summary">${esc(t("summaryTitle"))}</h2>
      <p>${esc(t("summaryScope", { pages, devices, runs, site: report.target.url }))}</p>
      <p class="lead">${esc(stats.problems === 0 ? t("summaryNone") : t("summaryFound", { count: stats.problems }))}</p>
      ${stats.problems === 0 ? "" : `<ul class="sev">${SEVERITY_ORDER.map((s) => `<li><span class="badge ${s}">${esc(sev(s))}</span> ${stats.bySeverity[s]}</li>`).join("")}</ul>`}
      ${top.length === 0 ? "" : `<h3>${esc(t("summaryTop"))}</h3><ol>${top.map((g) => `<li>${esc(groupTitle(ti, locale, g))} <span class="muted">(${esc(sev(g.severity))})</span></li>`).join("")}</ol>`}
      <div class="areas">
        ${areas
          .map(
            (a) => `<div class="area"><h3>${esc(t(`area.${a.area}`))}</h3><p class="muted">${esc(t(`areaHint.${a.area}`))}</p><p><strong>${a.problems}</strong> ${esc(t("problems", { count: a.problems }))}${a.worst === null ? "" : ` · ${esc(t("worst"))} ${esc(sev(a.worst))}`}</p></div>`,
          )
          .join("")}
      </div>
      <p class="muted">${esc(t("severityLegend"))}</p>
    </section>`;

  // The problems, area → subarea → group, each with its evidence and how to fix it.
  let shots = 0;
  const groupHtml = async (g: IssueGroup): Promise<string> => {
    const findings = g.findings.map((fid) => byId.get(fid)).filter((f): f is Finding => f !== undefined && f.verdict === "VERIFIED");
    const first = findings[0];
    if (first === undefined) return "";
    const example = g.examples.map((e) => byId.get(e)).find((f) => f !== undefined && f.verdict === "VERIFIED") ?? first;
    const image = shots < MAX_SHOTS ? await screenshot(dir, example) : null;
    if (image !== null) shots += 1;
    const zone = zoneOfGroup(findings);
    const where = [
      t("where.pages", { count: g.pages.length }),
      g.pages.length > 1 && g.pages.length >= pages ? t("where.everyPage") : null,
      zone === null ? null : t(`zone.${zone}`),
    ].filter((x): x is string => x !== null);
    const runsSeen = Math.max(...example.devices.filter((d) => d.verdict === "VERIFIED").map((d) => d.occurrences.length), 0);
    const steps = [
      t("steps.open", { page: example.page, devices: devicesText(t, example) }),
      t("steps.wait"),
      t("steps.see", { what: groupTitle(ti, locale, g) }),
    ];
    return `
      <article class="problem">
        <h4><span class="badge ${g.severity}">${esc(sev(g.severity))}</span> ${esc(groupTitle(ti, locale, g))}</h4>
        <p class="muted">${esc(where.join(" · "))} · ${esc(t("elements", { count: g.verified }))} · <strong>${esc(t("nOfN", { seen: runsSeen, runs }))}</strong> (${esc(devicesText(t, example))})</p>
        <p><strong>${esc(t("fixTitle"))}</strong> ${esc(recommendation(t, locale, g, first))}</p>
        <details open><summary>${esc(t("stepsTitle"))}</summary><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></details>
        <p class="muted small">${esc(t("pagesTitle"))} ${g.pages.slice(0, 8).map((p) => esc(shortUrl(p, report.target.origin))).join(", ")}${g.pages.length > 8 ? ` ${esc(t("more", { count: g.pages.length - 8 }))}` : ""}</p>
        ${image === null ? "" : `<figure><img src="${image}" alt="${esc(t("shotAlt", { page: shortUrl(example.page, report.target.origin) }))}"><figcaption>${esc(t("shotCaption", { page: shortUrl(example.page, report.target.origin) }))}</figcaption></figure>`}
      </article>`;
  };

  const sections: string[] = [];
  for (const a of areas) {
    const subs: string[] = [];
    for (const s of a.subareas) {
      const own = s.groups.filter((g) => g.verified > 0);
      if (own.length === 0) continue;
      const items: string[] = [];
      for (const g of [...own].sort((x, y) => SEVERITY_ORDER.indexOf(x.severity) - SEVERITY_ORDER.indexOf(y.severity))) items.push(await groupHtml(g));
      subs.push(`<section><h3>${esc(ti(`areas.subarea.${s.subarea}` as never))}</h3>${items.join("")}</section>`);
    }
    if (subs.length > 0) sections.push(`<section class="break"><h2>${esc(t(`area.${a.area}`))}</h2>${subs.join("")}</section>`);
  }

  // Lab performance, page by page: the median of the runs.
  const perfRows = new Map<string, InspectionReport["pages"]>();
  for (const p of report.pages) {
    if (!INSPECTABLE.includes(p.status) || p.metrics === null) continue;
    const key = `${p.url}\u0000${p.device}`;
    perfRows.set(key, [...(perfRows.get(key) ?? []), p]);
  }
  const cell = (visits: InspectionReport["pages"], k: "lcpMs" | "cls" | "tbtMs") => {
    const m = medianRange(visits.map((v) => (v.metrics === null ? null : v.metrics[k])));
    if (m === null) return "—";
    const text = k === "cls" ? m.median.toFixed(2) : m.median >= 1000 ? `${(m.median / 1000).toFixed(1)} s` : `${Math.round(m.median)} ms`;
    return `${esc(text)} <span class="muted">(${esc(t(`rating.${rate(k, m.median)}`))})</span>`;
  };
  const performance =
    perfRows.size === 0
      ? ""
      : `<section class="break"><h2>${esc(t("perfTitle"))}</h2><p class="muted">${esc(t("perfNote"))}</p>
        <table><thead><tr><th scope="col">${esc(t("perfPage"))}</th><th scope="col">${esc(t("perfDevice"))}</th><th scope="col">LCP</th><th scope="col">CLS</th><th scope="col">TBT</th></tr></thead><tbody>
        ${[...perfRows.values()]
          .map((v) => {
            const p = v[0] as InspectionReport["pages"][number];
            return `<tr><td>${esc(shortUrl(p.url, report.target.origin))}</td><td>${esc(t(`device.${p.device}`))}</td><td>${cell(v, "lcpMs")}</td><td>${cell(v, "cls")}</td><td>${cell(v, "tbtMs")}</td></tr>`;
          })
          .join("")}
        </tbody></table></section>`;

  const passive = `
    <section class="break" aria-labelledby="method">
      <h2 id="method">${esc(t("methodTitle"))}</h2>
      <p>${esc(t("passive"))}</p>
      <ul>
        <li>${esc(t("passivePublic"))}</li>
        <li>${esc(t("passiveNoActions"))}</li>
        <li>${esc(t("passiveRobots"))}</li>
        <li>${esc(t("passiveVerified", { runs }))}</li>
        <li>${esc(t("passiveLab"))}</li>
        ${report.access.session ? `<li>${esc(t("passiveSession"))}</li>` : ""}
      </ul>
      <p class="muted small">${esc(t("footer", { version: report.exegezisVersion, id }))}</p>
    </section>`;

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${esc(t("documentTitle", { site: new URL(report.target.url).host }))}</title>
<style>
  @page { size: A4; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: ${PRINT.text}; font-size: 11pt; line-height: 1.45; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 4pt; } h2 { font-size: 15pt; margin: 18pt 0 6pt; border-bottom: 1px solid ${PRINT.line}; padding-bottom: 3pt; }
  h3 { font-size: 12.5pt; margin: 12pt 0 4pt; } h4 { font-size: 11pt; margin: 0 0 4pt; }
  .muted { color: ${PRINT.muted}; } .small { font-size: 9pt; } .lead { font-size: 12.5pt; font-weight: 600; }
  .cover { border-bottom: 3px solid ${PRINT.brand}; padding-bottom: 10pt; margin-bottom: 6pt; }
  .brand { font-family: Consolas, monospace; letter-spacing: 2pt; font-weight: 700; color: ${PRINT.brand}; }
  .badge { display: inline-block; border: 1px solid; border-radius: 3pt; padding: 0 4pt; font-size: 8.5pt; font-weight: 700; text-transform: uppercase; }
  .badge.critical { color: ${PRINT.critical}; border-color: ${PRINT.critical}; } .badge.serious { color: ${PRINT.serious}; border-color: ${PRINT.serious}; }
  .badge.moderate { color: ${PRINT.moderate}; border-color: ${PRINT.moderate}; } .badge.minor { color: ${PRINT.minor}; border-color: ${PRINT.minor}; }
  ul.sev { list-style: none; padding: 0; display: flex; gap: 14pt; }
  .areas { display: flex; gap: 10pt; } .area { flex: 1; border: 1px solid ${PRINT.line}; border-radius: 4pt; padding: 6pt 8pt; }
  .problem { border: 1px solid ${PRINT.lineSoft}; border-radius: 4pt; padding: 7pt 9pt; margin: 6pt 0; break-inside: avoid; }
  figure { margin: 6pt 0 0; } img { max-width: 100%; max-height: 95mm; object-fit: cover; object-position: top; border: 1px solid ${PRINT.line}; }
  figcaption { font-size: 8.5pt; color: ${PRINT.muted}; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; } th, td { border-bottom: 1px solid ${PRINT.lineSoft}; text-align: left; padding: 3pt 4pt; }
  details summary { font-weight: 600; } ol { margin: 2pt 0 4pt 16pt; padding: 0; }
  .break { break-before: page; }
</style>
</head>
<body>
  <header class="cover">
    <p class="brand">EXEGEZIS</p>
    <h1>${esc(t("title"))}</h1>
    <p><strong>${esc(report.target.url)}</strong><br>${esc(t("date", { date }))} · ${esc(t("scopeLine", { pages, devices, runs }))}</p>
  </header>
  ${summary}
  ${sections.length === 0 ? `<p>${esc(t("noProblems"))}</p>` : sections.join("")}
  ${performance}
  ${passive}
</body>
</html>`;
}
