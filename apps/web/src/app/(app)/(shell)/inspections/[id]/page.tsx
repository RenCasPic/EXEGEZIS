import { assertionMessage, groupStats, SEVERITIES, type Finding, type InspectionReport } from "@exegezis/core";
import { AlertTriangle, Download, ExternalLink, FileCode2, Globe, ListChecks, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BlockNotice } from "@/components/access/block-notice";
import { EngineProblem } from "@/components/ui/copy-command";
import { FilterForm } from "@/components/ui/filter-form";
import { IssueGroupList } from "@/components/inspection/issue-groups";
import { buttonClass, CodeBlock, EmptyState, Meta, Mono, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { DeleteInspection } from "@/components/inspection/delete-inspection";
import { SeverityLabel } from "@/components/inspection/severity";
import { EngineText } from "@/components/ui/engine-text";
import { RunHistory, StatusPill, VerdictPill } from "@/components/ui/status";
import { getFormat } from "@/i18n/server";
import { accessEntry } from "@/lib/access";
import type { InspectionRef } from "@/lib/evidence/discover";
import { filterFindings, filterGroups, findInspection, loadFindingEvidence, pageRows, parseFindingFilters, sortFindings, type FindingEvidence } from "@/lib/evidence/inspections";
import { INSPECTION_STATUS_TONE, isKnownCheck, PAGE_STATUS_TONE, shortUrl } from "@/lib/inspection-labels";
import { findingTitle } from "@/lib/issue-labels";
import { artifactUrl } from "@/lib/urls";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("inspections.detail"))("metaTitle") };
}

type Params = Promise<{ id: string }>;

const BROWSER_NAME = { chromium: "Chromium (Playwright)", chrome: "Google Chrome", msedge: "Microsoft Edge" } as const;

/** The name of a check in the reader's language (unknown ids as they are). */
function checkName(t: (key: never) => string, id: string): string {
  return isKnownCheck(id) ? t(`check.${id}` as never) : id;
}
type Search = Promise<Record<string, string | string[] | undefined>>;

function Occurrences({ finding, runs }: { finding: Finding; runs: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <RunHistory runs={Array.from({ length: runs }, (_, i) => (finding.occurrences.includes(i + 1) ? "ok" : "off"))} />
      <span className="font-mono text-[11px] text-muted">
        {finding.occurrences.length}/{runs}
      </span>
    </span>
  );
}

function EvidenceBlock({ id, finding, evidence }: { id: string; finding: Finding; evidence: FindingEvidence }) {
  const shots = finding.evidence.filter((e) => e.kind === "screenshot");
  const dom = finding.evidence.find((e) => e.kind === "dom");
  const trace = finding.evidence.find((e) => e.kind === "trace");
  const t = useTranslations("inspections.detail");
  return (
    <div className="flex flex-col gap-4">
      {evidence.pageErrors.map((e) => (
        <div key={e.id}>
          <h4 className="mb-1 text-xs font-medium text-muted">{t("pageException")}</h4>
          <pre translate="no" className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-code p-2 font-mono text-[11px] text-fg">
            {e.name}: {e.message}
            {e.stack === undefined ? "" : `\n${e.stack}`}
          </pre>
        </div>
      ))}
      {evidence.console.map((m) => (
        <div key={m.id}>
          <h4 className="mb-1 text-xs font-medium text-muted">{t("console", { level: m.level })}</h4>
          <pre translate="no" className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-code p-2 font-mono text-[11px] text-fg">
            {m.text}
            {m.location === undefined ? "" : `\n  at ${m.location.url}:${m.location.line ?? "?"}`}
          </pre>
        </div>
      ))}
      {evidence.exchanges.map((x) => (
        <div key={x.id}>
          <h4 className="mb-1 text-xs font-medium text-muted">{t("exchange")}</h4>
          <div translate="no" className="rounded-md border border-line bg-code p-2 font-mono text-[11px]">
            <div className="break-all text-fg">
              {x.request.method} {x.request.url}
            </div>
            <div className={x.response === undefined || x.response.status >= 400 ? "text-bad" : "text-ok"}>
              {x.response === undefined ? t("noResponse", { error: x.failure?.errorText ?? t("unknown") }) : `${x.response.status} ${x.response.statusText}`}
              <span className="text-faint"> · {x.request.resourceType}</span>
            </div>
            {x.response?.body?.captured === true && x.response.body.text !== undefined && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-line pt-2 text-muted">{x.response.body.text}</pre>
            )}
          </div>
        </div>
      ))}
      {shots.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {shots.map((s) => (
            <figure key={s.path} className="overflow-hidden rounded-md border border-line">
              {/* A local evidence file, served as-is. */}
              <img src={artifactUrl(id, s.path)} alt={t("shotAlt")} className="w-full bg-white" loading="lazy" />
              <figcaption className="border-t border-line px-2 py-1.5 text-[11px] text-faint" translate="no">
                {s.description}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {dom !== undefined && (
        <details className="rounded-md border border-line">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted hover:text-fg">{t("dom")}</summary>
          <div className="border-t border-line">
            <iframe title={t("domTitle", { page: finding.page })} sandbox="" src={artifactUrl(id, dom.path)} className="h-80 w-full bg-white" loading="lazy" />
            <a href={artifactUrl(id, dom.path, { source: true })} target="_blank" rel="noreferrer" className="flex items-center gap-1 px-3 py-2 text-xs text-accent-text hover:underline">
              {t("source")} <ExternalLink className="size-3" />
            </a>
          </div>
        </details>
      )}
      {trace !== undefined && (
        <a href={artifactUrl(id, trace.path)} className={buttonClass("secondary", "sm") + " self-start"}>
          <Download /> {t("trace")}
        </a>
      )}
    </div>
  );
}

function FindingItem({ inspectionId, finding, report, evidence }: { inspectionId: string; finding: Finding; report: InspectionReport; evidence: FindingEvidence }) {
  const ti = useTranslations("inspections");
  const t = useTranslations("inspections.detail");
  const locale = useLocale();
  const title = findingTitle(ti, locale, finding.checkId, finding.title);
  return (
    <li className="border-b border-line last:border-b-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-hover/40 [&::-webkit-details-marker]:hidden">
          <VerdictPill verdict={finding.verdict} size="xs" />
          <SeverityLabel severity={finding.severity} />
          <span className="font-mono text-[11px] text-faint">{finding.id}</span>
          <span className="min-w-0 flex-1 basis-60 text-[13px] font-medium break-words text-fg">{title}</span>
          <span className="text-xs text-muted">{checkName(ti, finding.checkId)}</span>
          <span className="font-mono text-[11px] text-muted">{shortUrl(finding.page, report.target.origin)}</span>
          <Occurrences finding={finding} runs={report.options.runs} />
        </summary>
        <div className="grid gap-5 border-t border-line bg-panel-2 px-4 py-4 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <h4 className="mb-1 text-xs font-medium text-muted">{t("detailHeading")}</h4>
              <pre translate="no" className="overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-line bg-code p-2 font-mono text-[11px] text-fg">{finding.detail}</pre>
            </div>
            <div>
              <h4 className="mb-1 text-xs font-medium text-muted">{t("howToReproduce")}</h4>
              <ol className="list-decimal space-y-1 pl-5 text-[13px] text-fg">
                <li className="break-words">{t("repro.open", { page: finding.page })}</li>
                <li className="break-words">{t("repro.wait")}</li>
                {finding.assertion !== null && (
                  <li className="break-words">
                    {t("repro.check")} <EngineText message={assertionMessage(finding.assertion)} text={null} />
                  </li>
                )}
                <li className="break-words">
                  {t("repro.observed")} {title}
                </li>
              </ol>
            </div>
            <div>
              <h4 className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted">
                {t("spec")}
                {finding.spec !== null && (
                  <a href={artifactUrl(inspectionId, finding.spec, { download: true })} className={buttonClass("secondary", "sm")} download>
                    <Download /> {t("download")}
                  </a>
                )}
              </h4>
              {finding.spec === null ? (
                <p className="text-[13px] text-muted">
                  {finding.verdict === "INTERMITTENT" ? t("noSpecIntermittent") : t("noSpecAssertion")}
                </p>
              ) : evidence.spec === null ? (
                <p className="text-[13px] text-bad">{t("specMissing", { path: finding.spec })}</p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-faint">{t("specHelp")}</p>
                  <CodeBlock code={evidence.spec} maxHeight="18rem" />
                </>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <h4 className="mb-2 text-xs font-medium text-muted">{t("firstEvidence")}</h4>
            <EvidenceBlock id={inspectionId} finding={finding} evidence={evidence} />
          </div>
        </div>
      </details>
    </li>
  );
}

async function FindingList({ inspection, report, findings, empty }: { inspection: InspectionRef; report: InspectionReport; findings: Finding[]; empty: string }) {
  if (findings.length === 0) return <p className="px-4 py-6 text-[13px] text-muted">{empty}</p>;
  const evidence = await Promise.all(findings.map((f) => loadFindingEvidence(inspection, f)));
  return (
    <ul>
      {findings.map((f, i) => (
        <FindingItem key={f.id} inspectionId={inspection.id} finding={f} report={report} evidence={evidence[i] as FindingEvidence} />
      ))}
    </ul>
  );
}

export default async function InspectionPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const [inspection, t, ti, labels, f] = await Promise.all([findInspection(id), getTranslations("inspections.detail"), getTranslations("inspections"), getTranslations("labels"), getFormat()]);
  if (inspection === null) notFound();
  if (inspection.report.status !== "ok") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t("invalid")}
          eyebrow={<StatusPill status="INVALID_REPORT" tone="bad" />}
          description={<Mono>{inspection.relDir}</Mono>}
          actions={<DeleteInspection id={inspection.id} site={inspection.relDir} from="detail" />}
        />
        <Panel title={t("whyHidden")}>
          {inspection.report.status === "missing" ? (
            <p className="text-[13px] text-muted">{t("missing")}</p>
          ) : (
            <>
              <p className="mb-2 text-[13px] text-muted">{t("invalidBody")}</p>
              <ul className="list-disc pl-5 font-mono text-[12px] text-bad" translate="no">
                {inspection.report.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    );
  }

  const report = inspection.report.value;
  const filters = parseFindingFilters(await searchParams);
  const verified = sortFindings(report.findings.filter((f) => f.verdict === "VERIFIED"));
  const intermittent = sortFindings(report.findings.filter((f) => f.verdict === "INTERMITTENT"));
  const shown = filterFindings(verified, filters);
  const filtered = filters.severity !== null || filters.check !== null || filters.page !== null || filters.q !== "";
  const query = await searchParams;
  const view: "groups" | "elements" = query["vista"] === "elementos" ? "elements" : "groups";
  const stats = groupStats(report.groups, report.findings);
  const problemGroups = report.groups.filter((g) => g.verified > 0);
  const intermittentGroups = report.groups.filter((g) => g.verified === 0);
  const shownGroups = filterGroups(problemGroups, report.findings, filters);
  const viewHref = (v: "groups" | "elements") => {
    const next = new URLSearchParams();
    for (const [k, val] of Object.entries(query)) if (typeof val === "string" && k !== "vista" && val !== "") next.set(k, val);
    if (v === "elements") next.set("vista", "elementos");
    const q = next.toString();
    return q === "" ? `/inspections/${inspection.id}` : `/inspections/${inspection.id}?${q}`;
  };
  const pages = pageRows(report);
  const checksWithFindings = [...new Set(report.findings.map((f) => f.checkId))].sort();
  const pagesWithFindings = [...new Set(report.findings.map((f) => f.page))].sort();
  const writes = report.pageWrites;
  const s = report.summary;
  const entryBlock = report.pages.find((p) => p.depth === 0 && p.run === 1)?.block ?? null;
  const savedAccess = entryBlock === null ? null : await accessEntry(report.target.origin);
  const usedAccess = [report.access.session && t("accessKind.session"), report.access.httpCredentials && t("accessKind.http"), report.access.wafToken && t("accessKind.waf")].filter((x) => typeof x === "string");
  const severityOf = (sev: (typeof SEVERITIES)[number]) => labels(`severity.${sev}`);
  const all = (await getTranslations("common"))("filter.all");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<StatusPill status={report.status} tone={INSPECTION_STATUS_TONE[report.status]} />}
        title={<span className="break-all font-mono text-[20px]">{report.target.url}</span>}
        description={
          <>
            {ti(`statusText.${report.status}`)} {f.absolute(report.finishedAt)} · {f.duration(Date.parse(report.finishedAt) - Date.parse(report.startedAt))} ·{" "}
            <Mono>{inspection.id}</Mono>
          </>
        }
        actions={<DeleteInspection id={inspection.id} site={report.target.url} from="detail" />}
      />

      {report.engineError !== null && (
        <EngineProblem
          message={t("noBrowser", { origin: report.target.origin })}
          remedy={report.engineError.remedy}
          detail={[report.engineError.message, ...report.engineError.attempts.map((a) => `${a.engine}: ${a.error}`)]}
        />
      )}

      {entryBlock !== null && (
        <BlockNotice block={entryBlock} origin={report.target.origin} inspectionId={inspection.id} relaunchJobId={inspection.jobId} hasWafToken={savedAccess?.kinds.includes("wafToken") === true} />
      )}

      {writes.length > 0 && (
        <div role="alert" className="flex gap-3 rounded-lg border border-warn/40 bg-warn-bg px-4 py-3 text-[13px] text-fg">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div>
            <strong className="font-semibold">
              {t("writes", { count: writes.length })}
              {report.options.strictReadonly ? t("writesBlocked") : "."}
            </strong>{" "}
            {report.options.strictReadonly ? t("writesDegraded", { count: s.discardedByPolicy }) : t("writesExplain")}{" "}
            <a href="#page-writes" className="text-accent-text underline">
              {t("seeWrites")}
            </a>
          </div>
        </div>
      )}

      {report.engineError === null && (
        <>
        <section aria-label={t("summary")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Stat label={t("verifiedProblems")} value={stats.problems} hint={t("verifiedHint", { elements: stats.elements, pages: stats.pages })} />
          {(["critical", "serious", "moderate", "minor"] as const).map((sev) => (
            <Stat key={sev} label={severityOf(sev)} value={stats.bySeverity[sev]} hint={t("problemsHint")} />
          ))}
          <Stat label={t("intermittent")} value={stats.intermittentProblems} hint={t("intermittentHint", { count: stats.intermittentElements })} />
        </section>

        <nav aria-label={t("view")} className="flex flex-wrap items-center gap-1 text-[13px]">
          <Link href={viewHref("groups")} aria-current={view === "groups" ? "page" : undefined} className={view === "groups" ? "rounded-md bg-hover px-2.5 py-1 font-medium text-fg" : "rounded-md px-2.5 py-1 text-muted hover:text-fg"}>
            {t("byProblem", { count: problemGroups.length })}
          </Link>
          <Link href={viewHref("elements")} aria-current={view === "elements" ? "page" : undefined} className={view === "elements" ? "rounded-md bg-hover px-2.5 py-1 font-medium text-fg" : "rounded-md px-2.5 py-1 text-muted hover:text-fg"}>
            {t("eachElement", { count: verified.length })}
          </Link>
          {stats.info > 0 && <span className="ml-auto text-[12px] text-muted">{t("info", { count: stats.info })}</span>}
        </nav>

        <Panel
          title={view === "groups" ? t("problems", { count: problemGroups.length }) : t("verifiedFindings", { count: verified.length })}
          icon={<ListChecks />}
          subtitle={view === "groups" ? t("problemsSubtitle") : t("findingsSubtitle", { runs: report.options.runs })}
          bodyClassName="p-0"
        >
          {verified.length > 0 && (
            <div className="border-b border-line px-4 py-3">
              <Suspense>
                <FilterForm
                  hidden={view === "elements" ? { vista: "elementos" } : {}}
                  selects={[
                    { name: "severity", label: t("severity"), options: [{ value: "", label: all }, ...SEVERITIES.map((v) => ({ value: v, label: severityOf(v) }))] },
                    { name: "check", label: t("check"), options: [{ value: "", label: all }, ...checksWithFindings.map((c) => ({ value: c, label: checkName(ti as never, c) }))] },
                    { name: "page", label: t("page"), options: [{ value: "", label: all }, ...pagesWithFindings.map((p) => ({ value: p, label: shortUrl(p, report.target.origin) }))] },
                  ]}
                />
              </Suspense>
              {filtered && (
                <p className="mt-2 text-xs text-muted" aria-live="polite">
                  {view === "groups" ? t("filteredGroups", { shown: shownGroups.length, total: problemGroups.length }) : t("filteredFindings", { shown: shown.length, total: verified.length })}
                </p>
              )}
            </div>
          )}
          {verified.length === 0 ? (
            <EmptyState title={report.status === "COMPLETED" || report.status === "PARTIAL" ? t("noVerified") : t("notInspected")}>
              {report.status === "COMPLETED" || report.status === "PARTIAL" ? t("noVerifiedBody") : ti(`statusText.${report.status}`)}
            </EmptyState>
          ) : view === "groups" ? (
            <IssueGroupList inspectionId={inspection.id} groups={shownGroups} report={report} empty={t("noMatchGroups")} />
          ) : (
            <FindingList inspection={inspection} report={report} findings={shown} empty={t("noMatchFindings")} />
          )}
        </Panel>

        <Panel
          title={t("intermittentTitle", { count: view === "groups" ? intermittentGroups.length : intermittent.length })}
          subtitle={t("intermittentSubtitle")}
          bodyClassName="p-0"
        >
          {view === "groups" ? (
            <IssueGroupList inspectionId={inspection.id} groups={intermittentGroups} report={report} empty={t("noIntermittent")} />
          ) : (
            <FindingList inspection={inspection} report={report} findings={intermittent} empty={t("noIntermittent")} />
          )}
        </Panel>

        <Panel id="page-writes" title={t("pageWrites", { count: writes.length })} icon={<AlertTriangle />} subtitle={t("pageWritesSubtitle")} bodyClassName="p-0">
          {writes.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-muted">{t("noWrites")}</p>
          ) : (
            <div className={tableClass.wrap}>
              <table className={tableClass.table}>
                <thead>
                  <tr>
                    <th className={tableClass.th}>{t("colMethod")}</th>
                    <th className={tableClass.th}>{t("colUrl")}</th>
                    <th className={tableClass.th}>{t("colStatus")}</th>
                    <th className={tableClass.th}>{t("colFrom")}</th>
                    <th className={tableClass.th}>{t("colRun")}</th>
                  </tr>
                </thead>
                <tbody>
                  {writes.map((w, i) => (
                    <tr key={i} className={tableClass.tr}>
                      <td className={`${tableClass.td} font-mono`}>{w.method}</td>
                      <td className={`${tableClass.td} break-all font-mono text-[12px]`}>{w.url}</td>
                      <td className={`${tableClass.td} font-mono`}>{w.blocked ? <span className="text-warn">{t("blocked")}</span> : (w.status ?? "—")}</td>
                      <td className={`${tableClass.td} font-mono text-[12px]`}>{shortUrl(w.page, report.target.origin)}</td>
                      <td className={`${tableClass.td} font-mono`}>{w.run}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        </>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        {report.engineError === null ? (
          <Panel title={t("pages", { count: pages.length })} icon={<Globe />} bodyClassName="p-0">
            <div className={tableClass.wrap}>
              <table className={tableClass.table}>
                <thead>
                  <tr>
                    <th className={tableClass.th}>{t("colPage")}</th>
                    <th className={tableClass.th}>{t("colStatus")}</th>
                    <th className={tableClass.th}>HTTP</th>
                    <th className={tableClass.th}>{t("colVisits")}</th>
                    <th className={tableClass.th}>{t("colVerified")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => (
                    <tr key={p.url} className={tableClass.tr}>
                      <td className={`${tableClass.td} break-all font-mono text-[12px]`}>
                        {shortUrl(p.url, report.target.origin)}
                        {p.reason !== null && (
                          <div className="mt-0.5 font-sans text-[11px] break-words text-faint">
                            <EngineText message={p.reasonMessage} text={p.reason} />
                          </div>
                        )}
                      </td>
                      <td className={tableClass.td}>
                        <StatusPill status={p.status} tone={PAGE_STATUS_TONE[p.status as keyof typeof PAGE_STATUS_TONE]} size="xs" />
                      </td>
                      <td className={`${tableClass.td} font-mono`}>{p.httpStatus ?? "—"}</td>
                      <td className={`${tableClass.td} font-mono`}>
                        {p.runs}/{report.options.runs}
                      </td>
                      <td className={`${tableClass.td} font-mono`}>{p.findings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : (
          <div className="hidden xl:block" />
        )}
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={t("config")} icon={<Wrench />}>
            <Meta
              items={[
                { label: t("mode"), value: report.options.strictReadonly ? t("strictReadonly") : t("readonly") },
                { label: t("budget"), value: t("budgetValue", { pages: report.options.maxPages, depth: report.options.maxDepth, runs: report.options.runs }) },
                {
                  label: "robots.txt",
                  value: report.robots.respected
                    ? `${t("robotsRespected")}${report.robots.fetched ? "" : t("robotsNotFound")}${report.robots.disallow.length > 0 ? ` · Disallow ${report.robots.disallow.join(", ")}` : ""}`
                    : t("robotsIgnored"),
                },
                {
                  label: t("access"),
                  value:
                    usedAccess.length > 0 ? (
                      <span>
                        {t("withSession", { kinds: usedAccess.join(", ") })}
                        <span className="block text-[12px] text-muted">
                          {t("accessStored")}
                          {report.access.traceDropped ? ` ${t("traceDropped")}` : ""}
                        </span>
                      </span>
                    ) : report.options.storageState ? (
                      t("storageState")
                    ) : (
                      t("anonymous")
                    ),
                },
                ...(report.rateLimit.retries > 0 ? [{ label: t("rateLimit"), value: t("rateLimitValue", { count: report.rateLimit.retries, seconds: Math.round(report.rateLimit.waitedSeconds) }) }] : []),
                {
                  label: t("browser"),
                  value:
                    report.tools.browser === null ? (
                      <span className="text-muted">{report.engineError !== null ? t("noneStarted") : t("notRecorded")}</span>
                    ) : (
                      <span>
                        <Mono>{`${BROWSER_NAME[report.tools.browser.channel]} ${report.tools.browser.version}`}</Mono>
                        <span className="block text-[12px] text-muted">
                          {report.tools.browser.system ? t("systemBrowser") : t("playwrightChromium")}
                        </span>
                      </span>
                    ),
                },
                { label: "User-Agent", value: <Mono>{report.tools.userAgent}</Mono> },
                { label: "Playwright", value: <Mono>{report.tools.playwright}</Mono> },
                { label: "axe-core", value: report.tools.axe === null ? "—" : <Mono>{`${report.tools.axe} · ${t("rules", { count: report.tools.axeRules.length })}`}</Mono> },
                { label: t("checks"), value: <Mono>{report.tools.checks.map((c) => `${c.id}@${c.version}`).join(", ")}</Mono> },
                ...(report.totalTimeoutReached ? [{ label: t("totalTime"), value: <span className="text-warn">{t("exhausted")}</span> }] : []),
              ]}
            />
            <a href={artifactUrl(inspection.id, "inspection-report.json")} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-1 text-xs text-accent-text hover:underline">
              <FileCode2 className="size-3.5" /> inspection-report.json
            </a>
          </Panel>

          {report.skippedForSafety.length > 0 && (
            <Panel title={t("skipped", { count: report.skippedForSafety.length })} subtitle={t("skippedSubtitle")} bodyClassName="p-0">
              <ul className="max-h-72 overflow-auto">
                {report.skippedForSafety.map((l) => (
                  <li key={`${l.url} ${l.from}`} className="border-b border-line px-4 py-2 last:border-b-0">
                    <div className="break-all font-mono text-[12px] text-fg">{l.url}</div>
                    <div className="font-mono text-[11px] text-faint">
                      {t("from", { page: shortUrl(l.from, report.target.origin) })} · <span translate="no">{l.reason}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={t("external", { count: report.externalLinks.length })} subtitle={t("externalSubtitle")} bodyClassName="p-0">
            {report.externalLinks.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-muted">{t("none")}</p>
            ) : (
              <ul className="max-h-72 overflow-auto">
                {report.externalLinks.map((l) => (
                  <li key={`${l.url} ${l.from}`} className="border-b border-line px-4 py-2 last:border-b-0">
                    <div className="break-all font-mono text-[12px] text-fg">{l.url}</div>
                    <div className="font-mono text-[11px] text-faint">{t("from", { page: shortUrl(l.from, report.target.origin) })}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
