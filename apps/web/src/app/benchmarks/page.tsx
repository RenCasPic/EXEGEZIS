import { Beaker, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { NotImplemented, SourceTag, StatusPill } from "@/components/ui/status";
import { getIndex } from "@/lib/evidence/investigations";
import { absoluteTime, percent, relativeTime } from "@/lib/format";

export const metadata: Metadata = { title: "Benchmarks" };

export default async function BenchmarksPage() {
  const index = await getIndex();
  const runs = index.benchmarks.flatMap((b) => (b.result.status === "ok" ? [{ ref: b, r: b.result.value }] : []));
  const broken = index.benchmarks.filter((b) => b.result.status !== "ok");
  const sum = (f: (r: (typeof runs)[number]["r"]) => number) => runs.reduce((n, x) => n + f(x.r), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Verification Benchmark"
        description="Suites of seeded bugs and negative cases with an independent expected outcome. Benchmark A uses plans written by people; Benchmark B uses plans written by the AI planner from a symptom."
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat label="Benchmark runs" value={runs.length} hint={`${runs.filter((x) => x.ref.archived).length} archived in the repository`} />
        <Stat label="Cases evaluated" value={sum((r) => r.summary.total)} hint={`${sum((r) => r.summary.passed)} matched the expected outcome`} />
        <Stat label="Verified reproductions" value={sum((r) => r.summary.truePositives)} hint={`${sum((r) => r.summary.falseNegatives)} seeded bugs missed`} />
        <Stat label="Validated root causes" value={<span className="text-faint">—</span>} footer={<div className="mt-1"><NotImplemented size="xs" /></div>} />
        <Stat
          label="False validations"
          value={<span className={sum((r) => r.summary.falsePositives) === 0 ? "text-positive" : "text-critical"}>{sum((r) => r.summary.falsePositives)}</span>}
          hint="VERIFIED on a negative case"
        />
      </div>

      <Panel title={`${runs.length} runs`} icon={<Beaker />} bodyClassName="p-0">
        {runs.length === 0 ? (
          <EmptyState title="No benchmark results">
            Run <code className="font-mono">pnpm exegezis benchmark --suite buggy-shop</code> or <code className="font-mono">--suite buggy-shop-ai --planner anthropic</code>.
          </EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>Run</th>
                  <th className={tableClass.th}>Plans</th>
                  <th className={tableClass.th}>Result</th>
                  <th className={tableClass.th}>TP / FN</th>
                  <th className={tableClass.th}>FP / TN</th>
                  <th className={tableClass.th}>Inconclusive</th>
                  <th className={tableClass.th}>Source</th>
                  <th className={tableClass.th}>Finished</th>
                  <th className={tableClass.th} aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {runs.map(({ ref, r }) => (
                  <tr key={ref.id} className={tableClass.tr}>
                    <td className={tableClass.td}>
                      <Link href={`/benchmarks/${ref.id}`} className="font-medium text-fg hover:underline">
                        {r.suite}
                      </Link>
                      <div className="font-mono text-[11px] text-faint">{ref.id}</div>
                    </td>
                    <td className={`${tableClass.td} text-[12px] text-muted`}>
                      {r.planSource === "human" ? (
                        "A · human-written"
                      ) : (
                        <>
                          B · {r.planner?.model ?? r.planner?.provider} <span className="font-mono text-faint">{r.planner?.promptVersion}</span>
                          <div className="text-[11px] text-faint">{r.planner?.examples === true ? "with examples (leave-one-out)" : "no examples"}</div>
                        </>
                      )}
                    </td>
                    <td className={tableClass.td}>
                      <StatusPill status={`${r.summary.passed}/${r.summary.total} PASS`} tone={r.summary.failed === 0 ? "positive" : "critical"} size="xs" />
                    </td>
                    <td className={`${tableClass.td} font-mono text-[12px]`}>
                      {r.summary.truePositives} / {r.summary.falseNegatives}
                    </td>
                    <td className={`${tableClass.td} font-mono text-[12px]`}>
                      <span className={r.summary.falsePositives > 0 ? "text-critical" : ""}>{r.summary.falsePositives}</span> / {r.summary.trueNegatives}
                    </td>
                    <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{percent(r.metrics.inconclusiveRate, 1)}</td>
                    <td className={tableClass.td}>
                      <SourceTag kind={ref.archived ? "archived" : "real"} />
                    </td>
                    <td className={`${tableClass.td} whitespace-nowrap text-muted`} title={absoluteTime(r.finishedAt)}>
                      {relativeTime(r.finishedAt)}
                    </td>
                    <td className={`${tableClass.td} w-8`}>
                      <Link href={`/benchmarks/${ref.id}`} aria-label={`Open ${ref.id}`} className="text-faint hover:text-fg">
                        <ChevronRight className="size-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {broken.length > 0 && (
        <p className="text-xs text-critical">
          {broken.length} benchmark result file(s) could not be read or failed schema validation: {broken.map((b) => b.relDir).join(", ")}
        </p>
      )}
    </div>
  );
}
