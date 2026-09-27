import { ArrowRight, Beaker, Globe, LayoutList, Microscope } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { groupStats } from "@exegezis/core";
import { listTemplates } from "@exegezis/search/light";
import { InspectForm } from "@/components/home/inspect-form";
import { SearchForm, type TemplateOption } from "@/components/home/search-form";
import { EngineText } from "@/components/ui/engine-text";
import { EmptyState, Panel, TabLinks } from "@/components/ui/primitives";
import { EvidenceMeter, NotImplemented, ReplayTag, RunHistory, StatusPill, VerdictPill } from "@/components/ui/status";
import { formatFor } from "@/i18n/format";
import { getFormat } from "@/i18n/server";
import { cn } from "@/lib/cn";
import { buildCases, proofMetrics, type CaseGroup, type CaseRow } from "@/lib/evidence/cases";
import { listInspections } from "@/lib/evidence/inspections";
import { getRootCauses, getSummaries } from "@/lib/evidence/investigations";
import { latestPerCase } from "@/lib/evidence/root-causes";
import { NOT_IMPLEMENTED_STAGES, STAGES } from "@/lib/evidence/stages";
import { INSPECTION_STATUS_TONE } from "@/lib/inspection-labels";
import { getScope, inScope } from "@/lib/scope";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return { title: { absolute: `${t("title")} · EXEGEZIS` } };
}

const FILTERS: ("all" | CaseGroup)[] = ["all", "proven", "pending", "expected"];

function Origin({ row }: { row: CaseRow }) {
  const t = useTranslations("home.cases");
  const o = row.origin;
  if (o.kind === "replay") return <ReplayTag title={t("replayTitle")} />;
  if (o.kind === "ai")
    return (
      <span className="text-[12px] text-muted">
        {t("ai")} · <span className="font-mono">{o.model}</span>
      </span>
    );
  if (o.kind === "human") return <span className="text-[12px] text-muted">{t("humanPlan")}</span>;
  return <span className="text-[12px] text-faint">—</span>;
}

function Metric({ label, value, secondary, tone }: { label: string; value: string | number; secondary: React.ReactNode; tone?: "bad" | "ok" | undefined }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-panel px-4 py-3.5">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className={cn("font-mono text-[28px] leading-tight font-semibold tracking-tight", tone === "bad" ? "text-bad" : "text-fg")}>{value}</div>
      <div className="text-[12px] text-muted">{secondary}</div>
    </div>
  );
}

function CaseItem({ row, when }: { row: CaseRow; when: string }) {
  const t = useTranslations("home.cases");
  const status = useTranslations("labels.status");
  const real = row.runs.filter((r) => !r.replay);
  const replays = row.runs.length - real.length;
  const href = `/investigations/${row.latest.ref.id}`;
  const expected = row.expected === null ? "—" : status(row.expected);
  return (
    <li className="border-b border-line last:border-b-0">
      <div className="flex flex-col gap-2 px-4 py-3 hover:bg-hover/40">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1 basis-56">
            <Link href={href} className="block text-[13px] font-medium break-words text-fg hover:underline" translate="no">
              {row.title}
            </Link>
            <div className="truncate font-mono text-[11px] text-faint">
              {row.caseId}
              {row.suite !== null && ` · ${row.suite}`}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {row.outcome === null ? <StatusPill status="NOT_RUN" tone="q" size="xs" /> : <VerdictPill verdict={row.outcome} size="xs" />}
            {row.kind === "negative" && row.asExpected === false && (
              <span className="text-[11px] font-medium text-bad" title={t("expectedWas", { expected })}>
                {t("notAsExpected", { expected })}
              </span>
            )}
            {row.kind === "negative" && row.asExpected === true && <span className="text-[11px] text-muted">{t("asExpected")}</span>}
          </div>
        </div>
        {row.outcome !== "VERIFIED" && (row.latest.outcomeReason !== null || row.latest.outcomeMessage !== null) && (
          <p className="line-clamp-2 text-[12px] text-muted">
            <EngineText message={row.latest.outcomeMessage} text={row.latest.outcomeReason} />
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {row.kind === "negative" ? (
            <span className="text-[12px] text-faint" title={t("negativeNoEvidence")}>
              {t("evidenceNone")}
            </span>
          ) : (
            <EvidenceMeter level={row.evidence} />
          )}
          <span className="inline-flex items-center gap-1.5">
            <RunHistory runs={real.map((r) => r.mark)} />
            {replays > 0 && <ReplayTag title={t("replaysTitle", { count: replays })}>{t("replays", { count: replays })}</ReplayTag>}
          </span>
          <Origin row={row} />
          <span className="text-[12px] text-muted sm:ml-auto">{when}</span>
        </div>
      </div>
    </li>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [all, rootCauses, inspections, scope, params, t, common, f] = await Promise.all([
    getSummaries(),
    getRootCauses(),
    listInspections(),
    getScope(),
    searchParams,
    getTranslations("home"),
    getTranslations("common"),
    getFormat(),
  ]);
  const summaries = all.filter((s) => inScope(s, scope));
  const cases = buildCases(summaries);
  const m = proofMetrics(cases, summaries, latestPerCase(rootCauses));
  const filter = FILTERS.find((id) => id === params.casos) ?? "all";
  const shown = filter === "all" ? cases : cases.filter((c) => c.group === filter);
  const count = (id: "all" | CaseGroup) => (id === "all" ? cases.length : cases.filter((c) => c.group === id).length);
  const tab = params.modo === "buscar" ? "search" : "inspect";
  const templates: TemplateOption[] =
    tab === "search"
      ? (await listTemplates().catch(() => [])).map((tp) => ({ id: tp.id, name: tp.name, description: tp.description, origin: tp.origin, hasExact: tp.exact !== null, hasMeaning: tp.meaning !== null }))
      : [];

  const stageCounts = STAGES.map((stage) => {
    if (NOT_IMPLEMENTED_STAGES.includes(stage.id)) return { stage, count: null };
    const reached = cases.filter((c) => {
      const st = c.latest.stages.find((x) => x.id === stage.id);
      return st !== undefined && (st.tone === "ok" || st.tone === "warn");
    }).length;
    return { stage, count: reached };
  });
  const fmt = formatFor(f.locale);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="home-title" className="rounded-xl border border-line bg-panel p-5 sm:p-7">
        <div className="-mx-5 -mt-5 mb-5 sm:-mx-7 sm:-mt-7">
          <TabLinks
            active={tab}
            tabs={[
              { id: "inspect", label: t("tabs.inspect"), href: "/" },
              { id: "search", label: t("tabs.search"), href: "/?modo=buscar" },
            ]}
          />
        </div>
        <div className="text-[12px] font-semibold tracking-wider text-muted">{tab === "search" ? t("eyebrowSearch") : t("eyebrowInspect")}</div>
        <h1 id="home-title" className="mt-1 text-[26px] font-semibold tracking-tight text-fg sm:text-[30px]">
          {tab === "search" ? t("headingSearch") : t("headingInspect")}
        </h1>
        <p className="mt-1 mb-5 max-w-2xl text-[14px] text-muted">{tab === "search" ? t("introSearch") : t("introInspect")}</p>
        {tab === "search" ? <SearchForm templates={templates} /> : <InspectForm />}
        <Link href="/investigations/new" className="mt-4 inline-flex items-center gap-1 text-[13px] text-accent-text hover:underline">
          {t("haveSymptom")} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </section>

      <section aria-labelledby="proof-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="proof-title" className="text-[15px] font-semibold text-fg">
            {t("proven.title")}
          </h2>
          <span className="text-[12px] text-muted">{t("proven.note")}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label={t("metrics.verifiedBugs")} value={fmt.number(m.verifiedBugs)} secondary={t("metrics.verifiedBugsHint", { reproductions: m.reproductions, attempts: m.attempts })} />
          <Metric
            label={t("metrics.validatedCauses")}
            value={fmt.number(m.validatedCauses)}
            secondary={
              <>
                {t("metrics.validatedCausesHint", { cases: m.rootCauseCases })}
                {m.falseValidations > 0 && (
                  <>
                    {" · "}
                    <Link href="/verification/root-causes" className="font-medium text-bad underline">
                      {t("metrics.falseValidations", { count: m.falseValidations })}
                    </Link>
                  </>
                )}
              </>
            }
          />
          <Metric
            label={t("metrics.falseVerified")}
            value={fmt.number(m.falseVerified)}
            tone={m.falseVerified > 0 ? "bad" : undefined}
            secondary={t("metrics.falseVerifiedHint", { count: m.negativeCases })}
          />
          <Metric
            label={t("metrics.median")}
            value={fmt.duration(m.medianMsToVerify)}
            secondary={m.timedCases === 0 ? t("metrics.medianNone") : t("metrics.medianHint", { count: m.timedCases })}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel
          title={t("cases.title")}
          bodyClassName="p-0"
          actions={
            <Link href="/investigations" className="flex items-center gap-1 text-xs text-accent-text hover:underline">
              {t("cases.all")} <ArrowRight className="size-3" aria-hidden />
            </Link>
          }
        >
          <nav aria-label={t("cases.filterLabel")} className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
            {FILTERS.map((id) => (
              <Link
                key={id}
                href={id === "all" ? "/" : `/?casos=${id}`}
                scroll={false}
                aria-current={filter === id ? "page" : undefined}
                className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px]", filter === id ? "bg-hover font-medium text-fg" : "text-muted hover:text-fg")}
              >
                {t(`cases.filters.${id}`)}
                <span className="font-mono text-[11px] text-faint">{count(id)}</span>
              </Link>
            ))}
          </nav>
          {shown.length === 0 ? (
            <EmptyState icon={<LayoutList />} title={cases.length === 0 ? t("cases.none") : t("cases.noneInFilter")}>
              {cases.length === 0 ? (
                <>
                  {t("cases.noneBody")} <code className="font-mono">pnpm exegezis benchmark --suite buggy-shop</code>
                </>
              ) : (
                t("cases.tryAnother")
              )}
            </EmptyState>
          ) : (
            <ul>
              {shown.map((row) => (
                <CaseItem key={row.key} row={row} when={fmt.relative(row.createdAt)} />
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel
            title={t("recent.title")}
            icon={<Globe />}
            bodyClassName="p-0"
            actions={
              inspections.length > 0 ? (
                <Link href="/inspections" className="text-xs text-accent-text hover:underline">
                  {t("recent.all")}
                </Link>
              ) : undefined
            }
          >
            {inspections.length === 0 ? (
              <EmptyState icon={<Globe />} title={t("recent.none")}>
                {t("recent.noneBody")}
              </EmptyState>
            ) : (
              <ul>
                {inspections.slice(0, 5).map((i) => {
                  const r = i.report.status === "ok" ? i.report.value : null;
                  const g = r === null ? null : groupStats(r.groups, r.findings);
                  return (
                    <li key={i.id} className="border-b border-line last:border-b-0">
                      <Link href={`/inspections/${i.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[12px] text-fg">{r?.target.url ?? i.relDir}</div>
                          <div className="text-[11px] text-muted">
                            {r === null || g === null ? t("recent.invalid") : t("recent.line", { problems: g.problems, elements: g.elements, when: fmt.relative(r.finishedAt) })}
                          </div>
                        </div>
                        {r === null ? <StatusPill status="INVALID" tone="bad" size="xs" /> : <StatusPill status={r.status} tone={INSPECTION_STATUS_TONE[r.status]} size="xs" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title={t("capabilities.title")} bodyClassName="p-0">
            <ol>
              {stageCounts.map(({ stage, count: n }, i) => (
                <li key={stage.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0">
                  <span className="w-5 font-mono text-[11px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-fg">{common(`stages.${stage.id}.label`)}</div>
                    <div className="truncate text-[11px] text-muted">{common(`stages.${stage.id}.text`)}</div>
                  </div>
                  {n === null ? <NotImplemented size="xs" /> : <span className="font-mono text-[12px] text-muted">{t("capabilities.cases", { count: n })}</span>}
                </li>
              ))}
            </ol>
          </Panel>

          <nav aria-label={t("shortcuts.label")} className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-1">
            {(
              [
                { href: "/investigations", label: t("shortcuts.investigations"), icon: LayoutList },
                { href: "/verification/root-causes", label: t("shortcuts.rootCauses"), icon: Microscope },
                { href: "/benchmarks", label: t("shortcuts.benchmarks"), icon: Beaker },
              ] as const
            ).map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2.5 text-[13px] text-fg hover:bg-hover">
                <Icon className="size-4 text-muted" aria-hidden />
                {label}
                <ArrowRight className="ml-auto size-3.5 text-faint" aria-hidden />
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
