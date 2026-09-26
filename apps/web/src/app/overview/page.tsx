import { ArrowRight, Beaker, Database, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InvestigationsTable } from "@/components/tables/investigations-table";
import { ButtonLink, EmptyState, PageHeader, Panel, Stat } from "@/components/ui/primitives";
import { NotImplemented, StatusPill } from "@/components/ui/status";
import { getIndex, getSummaries } from "@/lib/evidence/investigations";
import { STAGES, NOT_IMPLEMENTED_STAGES } from "@/lib/evidence/stages";
import { duration, median, percent, relativeTime } from "@/lib/format";
import { getScope, inScope } from "@/lib/scope";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const [all, index, scope] = await Promise.all([getSummaries(), getIndex(), getScope()]);
  const summaries = all.filter((s) => inScope(s, scope));

  const verified = summaries.filter((s) => s.outcome === "VERIFIED");
  const distinctBugs = new Set(verified.map((s) => s.ref.caseId ?? s.planId ?? s.ref.id));
  const runs = new Set(summaries.map((s) => s.ref.benchmarkId ?? s.ref.id));
  const benchmarkCases = summaries.filter((s) => s.ref.kind === "benchmark-case").length;
  const verifyTimes = verified.map((s) => s.reproductionMs).filter((ms) => ms !== null);
  const benchmarks = index.benchmarks.flatMap((b) => (b.result.status === "ok" ? [{ ref: b, result: b.result.value }] : []));
  const falseVerified = benchmarks.reduce((n, b) => n + b.result.summary.falsePositives, 0);
  const negativeCases = benchmarks.reduce((n, b) => n + b.result.summary.falsePositives + b.result.summary.trueNegatives, 0);

  const stageCoverage = STAGES.map((stage) => {
    if (NOT_IMPLEMENTED_STAGES.includes(stage.id)) return { stage, count: null };
    const count = summaries.filter((s) => {
      const st = s.stages.find((x) => x.id === stage.id);
      return st !== undefined && !["NOT PROVIDED", "NOT RUN", "AWAITING EVIDENCE", "HUMAN PLAN"].includes(st.status);
    }).length;
    return { stage, count };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Software verification activity across your projects."
        actions={
          <ButtonLink href="/investigations/new" variant="primary">
            <Plus /> New Investigation
          </ButtonLink>
        }
      />

      <div className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-xs text-muted">
        <Database className="size-3.5 shrink-0 text-faint" />
        <span>
          Every number here is computed from run artifacts on disk (<code className="font-mono">runs/</code> and archived benchmark results). There is no demo data.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label="Verified bug reports" value={verified.length} hint={`${distinctBugs.size} distinct bug ids across ${runs.size} runs`} />
        <Stat label="Investigations" value={summaries.length} hint={`${summaries.length - benchmarkCases} ad-hoc · ${benchmarkCases} benchmark cases`} />
        <Stat label="Verified fixes" value={<span className="text-faint">—</span>} footer={<div className="mt-1"><NotImplemented size="xs" /></div>} />
        <Stat label="Median time to verification" value={duration(median(verifyTimes))} hint={`over ${verifyTimes.length} verified reproductions (all attempts)`} />
        <Stat
          label="False verifications"
          value={<span className={falseVerified === 0 ? "text-ok" : "text-bad"}>{falseVerified}</span>}
          hint={`VERIFIED on negative benchmark cases (${negativeCases} evaluated)`}
        />
      </div>

      <Panel title="Capability map" subtitle="What the engine can produce today" bodyClassName="p-0">
        <ol className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
          {stageCoverage.map(({ stage, count }, i) => (
            <li key={stage.id} className="flex flex-col gap-2 border-b border-line p-3 sm:border-r xl:border-b-0 [&:nth-child(8)]:border-r-0">
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
                {String(i + 1).padStart(2, "0")}
                <span className="text-[12px] font-sans font-medium text-fg">{stage.label}</span>
              </div>
              {count === null ? <NotImplemented size="xs" /> : <StatusPill status={`${count} recorded`} tone={count > 0 ? "ok" : "q"} size="xs" />}
            </li>
          ))}
        </ol>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel
          title="Recent investigations"
          bodyClassName="p-0"
          actions={
            <Link href="/investigations" className="flex items-center gap-1 text-xs text-muted hover:text-fg">
              View all <ArrowRight className="size-3" />
            </Link>
          }
        >
          <InvestigationsTable
            rows={summaries.slice(0, 8)}
            columns={["status", "reproduction", "rootCause", "fix", "created"]}
            empty={
              <EmptyState title="No investigations yet" action={<ButtonLink href="/investigations/new" variant="primary"><Plus /> New Investigation</ButtonLink>}>
                Start one here, or run <code className="font-mono">pnpm exegezis ai-verify --symptom &quot;…&quot;</code> in a terminal.
              </EmptyState>
            }
          />
        </Panel>

        <Panel title="Benchmarks" icon={<Beaker />} bodyClassName="p-0" actions={<Link href="/benchmarks" className="text-xs text-muted hover:text-fg">All</Link>}>
          {benchmarks.length === 0 ? (
            <EmptyState title="No benchmark results">Run <code className="font-mono">pnpm exegezis benchmark --suite buggy-shop</code>.</EmptyState>
          ) : (
            <ul>
              {benchmarks.slice(0, 6).map(({ ref, result }) => (
                <li key={ref.id} className="border-b border-line last:border-b-0">
                  <Link href={`/benchmarks/${ref.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-fg">{result.suite}</div>
                      <div className="truncate font-mono text-[11px] text-faint">
                        {result.planSource === "generated" ? `AI plans${result.planner?.examples === false ? " · no examples" : ""}` : "human plans"} ·{" "}
                        {ref.archived ? "archived" : relativeTime(result.finishedAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[13px] text-fg">
                        {result.summary.passed}/{result.summary.total}
                      </div>
                      <div className="font-mono text-[10px] text-faint">{percent(result.summary.total === 0 ? null : result.summary.passed / result.summary.total)}</div>
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
