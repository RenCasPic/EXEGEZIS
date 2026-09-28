import { queryParts } from "@exegezis/core";
import { compareSearches, describeQuery, markOf } from "@exegezis/search/light";
import { Bookmark, Bot, Download, FileCode2, Layers, RotateCw, Search as SearchIcon, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { approveCostAction, repeatSearchAction, saveSearchAction } from "@/app/search-actions";
import { BlockNotice } from "@/components/access/block-notice";
import { HitCard } from "@/components/search/hit-card";
import { EngineProblem } from "@/components/ui/copy-command";
import { FilterForm } from "@/components/ui/filter-form";
import { buttonClass, EmptyState, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { EngineText } from "@/components/ui/engine-text";
import { StatusPill } from "@/components/ui/status";
import { accessEntry } from "@/lib/access";
import { filterHits, findSearch, groupHits, loadReview, parseHitFilters, previousRun, visitShots } from "@/lib/evidence/searches";
import { getFormat, getUiLocale } from "@/i18n/server";
import { PAGE_STATUS_TONE, shortUrl } from "@/lib/inspection-labels";
import { SEARCH_STATUS_TONE } from "@/lib/search-labels";
import { artifactUrl } from "@/lib/urls";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("searches.detail"))("metaTitle") };
}

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const input = "h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-panel px-2.5 text-[13px] text-fg";

export default async function SearchPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const [ref, t, ts, f, locale] = await Promise.all([findSearch(id), getTranslations("searches.detail"), getTranslations("searches"), getFormat(), getUiLocale()]);
  if (ref === null) notFound();
  const usd = f.usd;
  if (ref.report.status !== "ok") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("invalid")} eyebrow={<StatusPill status="INVALID_REPORT" tone="bad" />} description={<Mono>{ref.relDir}</Mono>} />
        <Panel title={t("whyHidden")}>
          {ref.report.status === "missing" ? (
            <p className="text-[13px] text-muted">{t("missing")}</p>
          ) : (
            <>
              <p className="mb-2 text-[13px] text-muted">{t("invalidBody")}</p>
              <ul className="list-disc pl-5 font-mono text-[12px] text-bad" translate="no">
                {ref.report.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>
    );
  }

  const report = ref.report.value;
  const query = await searchParams;
  const filters = parseHitFilters(query);
  const [review, previous] = await Promise.all([loadReview(ref), previousRun(ref)]);
  const comparison = previous === null ? null : compareSearches(report, previous.report);
  const shown = filterHits(report.hits, filters, review, comparison);
  const groups = groupHits(shown, filters.group);
  const shots = await visitShots(ref, shown.map((h) => h.runPath).filter((p) => p !== null));
  const cov = report.coverage;
  const s = report.summary;
  const entryBlock = report.pages.find((p) => p.depth === 0 && p.run === 1)?.block ?? null;
  const savedAccess = entryBlock === null ? null : await accessEntry(report.target.origin);
  const ai = report.ai;
  const parts = queryParts(report.query);
  const firstRun = report.pages.filter((p) => p.run === 1);
  const newCount = comparison === null ? 0 : [...comparison.novelty.values()].filter((n) => n === "new").length;
  const filtered = filters.verdict !== "all" || filters.mark !== "all" || filters.onlyNew || filters.q !== "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={<StatusPill status={report.status} tone={SEARCH_STATUS_TONE[report.status]} />}
        title={<span className="break-all font-mono text-[20px]">{report.target.url}</span>}
        description={
          <>
            <span className="block text-fg">
              {report.query.kind === "exact" ? t("exact") : report.query.kind === "meaning" ? t("meaning") : t("template", { name: report.query.name, version: report.query.version })}:{" "}
              <strong translate="no">{describeQuery(report, locale)}</strong>
            </span>
            {ts(`statusText.${report.status}`)} {f.absolute(report.finishedAt)} · {f.duration(Date.parse(report.finishedAt) - Date.parse(report.startedAt))} · <Mono>{ref.id}</Mono>
            {report.access.session || report.access.httpCredentials || report.access.wafToken ? ` · ${t("withSession")}` : ""}
          </>
        }
        actions={
          <form action={repeatSearchAction}>
            <input type="hidden" name="search" value={ref.id} />
            <button type="submit" className={buttonClass("secondary")}>
              <RotateCw aria-hidden /> {t("repeat")}
            </button>
          </form>
        }
      />

      {report.engineError !== null && (
        <EngineProblem
          message={t("noBrowser", { origin: report.target.origin })}
          remedy={report.engineError.remedy}
          detail={[report.engineError.message, ...report.engineError.attempts.map((a) => `${a.engine}: ${a.error}`)]}
        />
      )}
      {entryBlock !== null && <BlockNotice block={entryBlock} origin={report.target.origin} inspectionId={ref.id} relaunchJobId={null} hasWafToken={savedAccess?.kinds.includes("wafToken") === true} />}

      <section aria-label={t("coverage")} className="rounded-lg border border-line bg-panel p-4">
        <p className="text-[15px] font-semibold text-fg">{t("searched", { searched: cov.searched, found: cov.found })}</p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
          <li>{t("budget", { pages: report.options.maxPages, depth: report.options.maxDepth, runs: report.options.runs })}</li>
          {cov.skippedBudget > 0 && <li className="text-warn">{t("skippedBudget", { count: cov.skippedBudget })}</li>}
          {cov.skippedRobots > 0 && <li>{t("skippedRobots", { count: cov.skippedRobots })}</li>}
          {cov.skippedSafety > 0 && <li>{t("skippedSafety", { count: cov.skippedSafety })}</li>}
          {cov.blocked.length > 0 && <li className="text-warn">{t("blocked", { count: cov.blocked.length, kinds: [...new Set(cov.blocked.map((b) => b.kind))].join(", ") })}</li>}
          {cov.failed > 0 && <li className="text-warn">{t("failed", { count: cov.failed })}</li>}
          {report.options.includeHidden ? <li>{t("includesHidden")}</li> : <li>{t("noHidden")}</li>}
        </ul>
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] text-accent-text">{t("seePages")}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {firstRun.map((p) => (
              <li key={p.url} className="flex min-w-0 items-center gap-2 text-[12px]">
                <StatusPill status={p.status} tone={PAGE_STATUS_TONE[p.status]} size="xs" />
                <span className="min-w-0 truncate font-mono text-muted" title={p.url}>
                  {shortUrl(p.url, report.target.origin)}
                </span>
                <span className="shrink-0 text-faint">{t("pageResults", { count: report.hits.filter((h) => h.page === p.url).length })}</span>
              </li>
            ))}
          </ul>
        </details>
        <p className="mt-3 text-[13px] text-fg">
          {t("summary", { hits: s.hits, pages: s.pagesWithHits, verified: s.verified, intermittent: s.intermittent })}
          {parts.meaning !== null && t("summarySuggested", { count: s.suggested })}
          {s.hidden > 0 && t("summaryHidden", { count: s.hidden })}
          {s.byVariant > 0 && t("summaryVariant", { count: s.byVariant })}.
        </p>
        {report.excluded.map((e) => (
          <p key={e.term} className="mt-1 text-[13px] text-muted">
            {t("excluded", { term: e.term, scope: e.scope, hits: e.hits, blocks: e.blocks, pages: e.pages })}
          </p>
        ))}
        {parts.exact?.variants === true && <p className="mt-1 text-[12px] text-muted">{t("variantsNote")}</p>}
      </section>

      {ai !== null && (
        <Panel title={t("aiPanel")} icon={<Bot />}>
          {report.status === "COST_LIMIT" && ai.calls === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-[14px] text-fg">{t.rich("wouldCost", { estimate: usd(ai.estimateUsd), limit: usd(ai.maxCostUsd), strong: (chunks) => <strong>{chunks}</strong> })}</p>
              <form action={approveCostAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="search" value={ref.id} />
                <button type="submit" className={buttonClass("primary")}>
                  {t("approve", { estimate: usd(ai.estimateUsd) })}
                </button>
                <span className="text-[12px] text-muted">{t("approveHelp")}</span>
              </form>
            </div>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px] text-fg">
              <li>{t("aiLine", { model: ai.model, calls: ai.calls, input: f.number(ai.inputTokens), output: f.number(ai.outputTokens), seconds: f.number(ai.latencyMs / 1000, 1) })}</li>
              <li>{t.rich("aiCost", { cost: usd(ai.costUsd), estimate: usd(ai.estimateUsd), limit: usd(ai.maxCostUsd), prompt: ai.promptVersion, strong: (chunks) => <strong>{chunks}</strong> })}</li>
              <li>
                {t("aiPages", { count: ai.pagesSent.length })}
                {ai.redactions > 0 && t("aiRedactions", { count: ai.redactions })}
              </li>
              {s.discardedQuotes > 0 && <li className="text-warn">{t("discarded", { count: s.discardedQuotes })}</li>}
              {ai.error !== null && (
                <li className="text-bad">
                  <EngineText message={ai.errorMessage} text={ai.error} />
                </li>
              )}
              <li className="text-muted">{t("aiCaveat")}</li>
            </ul>
          )}
        </Panel>
      )}

      <Panel
        title={filtered ? t("resultsFiltered", { shown: shown.length, total: report.hits.length }) : t("results", { count: report.hits.length })}
        icon={<SearchIcon />}
        bodyClassName="p-0"
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <a href={`/api/searches/${encodeURIComponent(ref.id)}/export?format=csv&sep=%3B`} className={buttonClass("ghost", "sm")}>
              <Download aria-hidden /> {t("csvExcel")}
            </a>
            <a href={`/api/searches/${encodeURIComponent(ref.id)}/export?format=csv&sep=%2C`} className={buttonClass("ghost", "sm")} title={t("csvComma")}>
              {t("csvCommaShort")}
            </a>
            <a href={`/api/searches/${encodeURIComponent(ref.id)}/export?format=pdf`} className={buttonClass("ghost", "sm")}>
              <Download aria-hidden /> PDF
            </a>
          </div>
        }
      >
        {report.hits.length > 0 && (
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
            <Suspense>
              <FilterForm
                placeholder={t("filterPlaceholder")}
                selects={[
                  {
                    name: "tipo",
                    label: t("type"),
                    options: [
                      { value: "", label: t("allMasc") },
                      { value: "verificados", label: t("verified") },
                      { value: "intermitentes", label: t("intermittent") },
                      ...(parts.meaning === null ? [] : [{ value: "sugerencias", label: t("suggestions") }]),
                    ],
                  },
                  {
                    name: "revision",
                    label: t("review"),
                    options: [
                      { value: "", label: t("allFem") },
                      { value: "relevante", label: ts("review.relevant") },
                      { value: "no-relevante", label: ts("review.not-relevant") },
                      { value: "pendiente", label: ts("review.pending") },
                    ],
                  },
                  {
                    name: "agrupar",
                    label: t("group"),
                    options: [
                      { value: "", label: t("byPage") },
                      { value: "termino", label: t("byTerm") },
                    ],
                  },
                  ...(comparison === null
                    ? []
                    : [
                        {
                          name: "nuevo",
                          label: t("novelty"),
                          options: [
                            { value: "", label: t("everything") },
                            { value: "1", label: t("onlyNew", { count: newCount }) },
                          ],
                        },
                      ]),
                ]}
              />
            </Suspense>
            {comparison !== null && previous !== null && (
              <p className="text-[12px] text-muted">
                {t.rich("comparison", {
                  new: newCount,
                  gone: comparison.gone.length,
                  link: () => (
                    <Link href={`/searches/${previous.ref.id}`} className="text-accent-text hover:underline">
                      {previous.ref.id}
                    </Link>
                  ),
                })}
              </p>
            )}
          </div>
        )}

        {report.hits.length === 0 ? (
          <EmptyState icon={<SearchIcon />} title={t("noMatches", { count: cov.searched })}>
            {cov.searched === 0 ? t("noneSearched") : t("noMatchesBody", { searched: cov.searched, found: cov.found, skipped: cov.skippedBudget })}
          </EmptyState>
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-muted">{t("noneFiltered")}</p>
        ) : (
          <div>
            {groups.map((g) => (
              <section key={g.key} aria-label={g.key} className="border-b border-line last:border-b-0">
                <h3 className="flex items-center gap-2 bg-sunken px-4 py-2 text-[12px] font-semibold text-fg">
                  <Layers className="size-3.5 text-muted" aria-hidden />
                  <span className="min-w-0 break-all" translate="no">
                    {filters.group === "page" ? shortUrl(g.key, report.target.origin) : g.key}
                  </span>
                  <span className="font-mono text-[11px] font-normal text-faint">{g.hits.length}</span>
                </h3>
                {g.hits.map((h) => (
                  <HitCard
                    key={h.id}
                    searchId={ref.id}
                    hit={h}
                    runs={report.options.runs}
                    mark={markOf(review, h)}
                    shot={h.runPath === null ? null : (shots.get(h.runPath) ?? null)}
                    novelty={comparison?.novelty.get(h.id) ?? null}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
        {filters.onlyNew && comparison !== null && comparison.gone.length > 0 && (
          <div className="border-t border-line px-4 py-3">
            <h3 className="text-[13px] font-semibold text-fg">{t("gone", { count: comparison.gone.length })}</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {comparison.gone.map((h) => (
                <li key={h.id} className="text-[12px] text-muted">
                  <span className="font-mono">{shortUrl(h.page, report.target.origin)}</span> — <span translate="no">«{h.quote}»</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={t("save")} icon={<Bookmark />}>
          {report.savedSearchId !== null ? (
            <p className="text-[13px] text-muted">
              {t.rich("isSaved", {
                link: (chunks) => (
                  <Link href="/searches#guardadas" className="text-accent-text hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          ) : (
            <form action={saveSearchAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="search" value={ref.id} />
              <label htmlFor="save-name" className="sr-only">
                {t("name")}
              </label>
              <input id="save-name" name="name" required maxLength={200} placeholder={t("namePlaceholder")} className={input} />
              <button type="submit" className={buttonClass("secondary")}>
                {t("saveButton")}
              </button>
            </form>
          )}
        </Panel>
        <Panel title={t("tools")} icon={<ShieldCheck />}>
          <ul className="flex flex-col gap-1 text-[13px] text-muted">
            <li>{t("mode", { mode: report.options.strictReadonly ? t("strict") : t("readonly"), robots: report.robots.respected ? t("respected") : t("ignored") })}</li>
            {report.tools.browser !== null && (
              <li>
                {t("browser")} <Mono>{`${report.tools.browser.channel} ${report.tools.browser.version}`}</Mono>
              </li>
            )}
            {report.tools.stemmer !== null && (
              <li>
                {t("variants")} <Mono>{report.tools.stemmer}</Mono>
              </li>
            )}
            <li>
              <a href={artifactUrl(ref.id, "search-report.json")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-text hover:underline">
                <FileCode2 className="size-3.5" aria-hidden /> search-report.json
              </a>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
