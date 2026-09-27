import { ArrowRight, Beaker, Database, Plus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { InvestigationsTable } from "@/components/tables/investigations-table";
import { ButtonLink, EmptyState, PageHeader, Panel, Stat } from "@/components/ui/primitives";
import { NotImplemented, StatusPill } from "@/components/ui/status";
import { isReplay } from "@/lib/evidence/cases";
import { getIndex, getSummaries } from "@/lib/evidence/investigations";
import { STAGES, NOT_IMPLEMENTED_STAGES, NOT_REACHED } from "@/lib/evidence/stages";
import { median } from "@/lib/format";
import { getFormat } from "@/i18n/server";
import { getScope, inScope } from "@/lib/scope";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("overview"))("title") };
}

export default async function OverviewPage() {
  const [all, index, scope, t, stages, f] = await Promise.all([getSummaries(), getIndex(), getScope(), getTranslations("overview"), getTranslations("common.stages"), getFormat()]);
  const summaries = all.filter((s) => inScope(s, scope));

  // Replayed planner responses (mock) are not results: they are listed elsewhere, never counted here.
  const verified = summaries.filter((s) => s.outcome === "VERIFIED" && !isReplay(s));
  const distinctBugs = new Set(verified.map((s) => s.ref.caseId ?? s.planId ?? s.ref.id));
  const runs = new Set(summaries.map((s) => s.ref.benchmarkId ?? s.ref.id));
  const benchmarkCases = summaries.filter((s) => s.ref.kind === "benchmark-case").length;
  const verifyTimes = verified.map((s) => s.reproductionMs).filter((ms) => ms !== null);
  const benchmarks = index.benchmarks.flatMap((b) => (b.result.status === "ok" ? [{ ref: b, result: b.result.value }] : []));
  const liveBenchmarks = benchmarks.filter((b) => b.result.planner?.provider !== "mock");
  const falseVerified = liveBenchmarks.reduce((n, b) => n + b.result.summary.falsePositives, 0);
  const negativeCases = liveBenchmarks.reduce((n, b) => n + b.result.summary.falsePositives + b.result.summary.trueNegatives, 0);

  const stageCoverage = STAGES.map((stage) => {
    if (NOT_IMPLEMENTED_STAGES.includes(stage.id)) return { stage, count: null };
    const count = summaries.filter((s) => {
      const st = s.stages.find((x) => x.id === stage.id);
      return st !== undefined && !NOT_REACHED.includes(st.status);
    }).length;
    return { stage, count };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <ButtonLink href="/investigations/new" variant="primary">
            <Plus /> {t("new")}
          </ButtonLink>
        }
      />

      <div className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
        <Database className="size-3.5 shrink-0 text-faint" />
        <span>
          {t("noDemo", { runs: "runs/" })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label={t("verifiedReports")} value={verified.length} hint={t("verifiedReportsHint", { bugs: distinctBugs.size, runs: runs.size })} />
        <Stat label={t("investigations")} value={summaries.length} hint={t("investigationsHint", { adhoc: summaries.length - benchmarkCases, cases: benchmarkCases })} />
        <Stat label={t("verifiedFixes")} value={<span className="text-faint">—</span>} footer={<div className="mt-1"><NotImplemented size="xs" /></div>} />
        <Stat label={t("median")} value={f.duration(median(verifyTimes))} hint={t("medianHint", { count: verifyTimes.length })} />
        <Stat
          label={t("falseVerifications")}
          value={<span className={falseVerified === 0 ? "text-ok" : "text-bad"}>{falseVerified}</span>}
          hint={t("falseVerificationsHint", { count: negativeCases })}
        />
      </div>

      <Panel title={t("capabilityMap")} subtitle={t("capabilitySubtitle")} bodyClassName="p-0">
        <ol className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
          {stageCoverage.map(({ stage, count }, i) => (
            <li key={stage.id} className="flex flex-col gap-2 border-b border-line p-3 sm:border-r xl:border-b-0 [&:nth-child(8)]:border-r-0">
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
                {String(i + 1).padStart(2, "0")}
                <span className="text-[12px] font-sans font-medium text-fg">{stages(`${stage.id}.label`)}</span>
              </div>
              {count === null ? <NotImplemented size="xs" /> : <StatusPill status={t("recorded", { count })} tone={count > 0 ? "ok" : "q"} size="xs" />}
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title={t("recent")}
          bodyClassName="p-0"
          actions={
            <Link href="/investigations" className="flex items-center gap-1 text-xs text-muted hover:text-fg">
              {t("viewAll")} <ArrowRight className="size-3" />
            </Link>
          }
        >
          <InvestigationsTable
            rows={summaries.slice(0, 8)}
            columns={["status", "reproduction", "rootCause", "fix", "created"]}
            empty={
              <EmptyState
                title={t("none")}
                action={
                  <ButtonLink href="/investigations/new" variant="primary">
                    <Plus /> {t("new")}
                  </ButtonLink>
                }
              >
                {t("noneBody", { command: 'pnpm exegezis ai-verify --symptom "…"' })}
              </EmptyState>
            }
          />
        </Panel>

        <Panel
          title={t("benchmarks")}
          icon={<Beaker />}
          bodyClassName="p-0"
          actions={
            <Link href="/benchmarks" className="text-xs text-muted hover:text-fg">
              {t("all")}
            </Link>
          }
        >
          {benchmarks.length === 0 ? (
            <EmptyState title={t("noBenchmarks")}>{t("noBenchmarksBody", { command: "pnpm exegezis benchmark --suite buggy-shop" })}</EmptyState>
          ) : (
            <ul>
              {benchmarks.slice(0, 6).map(({ ref, result }) => (
                <li key={ref.id} className="border-b border-line last:border-b-0">
                  <Link href={`/benchmarks/${ref.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-fg">{result.suite}</div>
                      <div className="truncate font-mono text-[11px] text-faint">
                        {result.planSource === "generated" ? (result.planner?.provider === "mock" ? t("replayedPlans") : result.planner?.examples === false ? t("aiPlansNoExamples") : t("aiPlans")) : t("humanPlans")} ·{" "}
                        {ref.archived ? t("archived") : f.relative(result.finishedAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[13px] text-fg">
                        {result.summary.passed}/{result.summary.total}
                      </div>
                      <div className="font-mono text-[10px] text-faint">{f.percent(result.summary.total === 0 ? null : result.summary.passed / result.summary.total)}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
