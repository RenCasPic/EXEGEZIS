import { ArrowLeft, Beaker, Gauge } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { join } from "node:path";
import { BenchmarkSuite } from "@exegezis/core";
import { Meta, Mono, PageHeader, Panel, tableClass } from "@/components/ui/primitives";
import { NotImplemented, OutcomePill, SourceTag, StatusPill } from "@/components/ui/status";
import { findBenchmark, getIndex } from "@/lib/evidence/investigations";
import { readArtifact, valueOf } from "@/lib/evidence/read";
import { absoluteTime, duration, percent } from "@/lib/format";
import { benchmarksDir } from "@/lib/workspace";

export const metadata: Metadata = { title: "Benchmark run" };

const METRICS = [
  ["planValidityRate", "Plan validity", "Generated plans that are valid TestPlans (declines excluded)"],
  ["semanticValidityRate", "Semantic validity", "Plans that pass validation against the live page"],
  ["verificationSuccess", "Verification success", "Seeded bugs that reached VERIFIED"],
  ["falsePositiveRate", "False positive rate", "Negative cases that reached VERIFIED"],
  ["inconclusiveRate", "Inconclusive rate", "Cases that ended INCONCLUSIVE"],
  ["invalidPlanRate", "Invalid plan rate", "Cases that ended INVALID_PLAN"],
  ["reproductionRate", "Reproduction rate", "Failing attempts over executed positive cases"],
  ["anchorQuality", "Anchor quality", "Executable plans whose anchors held"],
  ["selectorQuality", "Selector quality", "Plan targets found on the observed page"],
  ["playwrightAgreement", "Playwright agreement", "Compiled test agreed with the engine"],
] as const;

export default async function BenchmarkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ref = await findBenchmark(id);
  if (ref === null) notFound();
  if (ref.result.status !== "ok") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={id} description="This benchmark result could not be read." />
        <p className="text-[13px] text-critical">{ref.result.status === "missing" ? "benchmark-result.json is missing." : ref.result.issues.join("; ")}</p>
      </div>
    );
  }
  const r = ref.result.value;
  const [index, suite] = await Promise.all([getIndex(), readArtifact(join(benchmarksDir(), r.suite, "suite.json"), BenchmarkSuite)]);
  const investigations = new Map(index.investigations.filter((i) => i.benchmarkId === id).map((i) => [i.caseId, i.id]));
  const suiteDef = valueOf(suite);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/benchmarks" className="flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <ArrowLeft className="size-3" /> Benchmarks
      </Link>
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <StatusPill status={`${r.summary.passed}/${r.summary.total} PASS`} tone={r.summary.failed === 0 ? "positive" : "critical"} />
            <SourceTag kind={ref.archived ? "archived" : "real"} />
          </div>
        }
        title={`${r.suite} · ${r.planSource === "human" ? "Benchmark A (human plans)" : "Benchmark B (AI plans)"}`}
        description={suiteDef?.description}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Panel title="Metrics" icon={<Gauge />} bodyClassName="p-0">
          <div className="grid grid-cols-2 md:grid-cols-5">
            {METRICS.map(([key, label, hint]) => (
              <div key={key} className="border-b border-r border-line p-3" title={hint}>
                <div className="text-[11px] text-muted">{label}</div>
                <div className="mt-1 font-mono text-[18px] font-semibold text-fg">{percent(r.metrics[key], 1)}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4">
            {(
              [
                ["True positives", r.summary.truePositives],
                ["False negatives", r.summary.falseNegatives],
                ["False positives", r.summary.falsePositives],
                ["True negatives", r.summary.trueNegatives],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="border-r border-line p-3 last:border-r-0">
                <div className="text-[11px] text-muted">{label}</div>
                <div className={`mt-1 font-mono text-[18px] font-semibold ${label === "False positives" && value > 0 ? "text-critical" : "text-fg"}`}>{value}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Run" icon={<Beaker />}>
          <Meta
            className="text-[12px]"
            items={[
              { label: "Run", value: <Mono className="break-all">{id}</Mono> },
              { label: "Runs per case", value: r.runsPerCase },
              { label: "Plans", value: r.planSource === "human" ? "human-written" : "generated from symptoms" },
              ...(r.planner === null
                ? []
                : [
                    { label: "Planner", value: <Mono>{`${r.planner.provider} / ${r.planner.model ?? "—"}`}</Mono> },
                    { label: "Prompt", value: <Mono>{r.planner.promptVersion}</Mono> },
                    { label: "Examples", value: r.planner.examples ? "leave-one-out" : "none" },
                  ]),
              { label: "Target", value: <Mono className="break-all">{r.baseUrl}</Mono> },
              { label: "Engine", value: `exegezis ${r.exegezisVersion}` },
              { label: "Started", value: absoluteTime(r.startedAt) },
              { label: "Took", value: duration(Date.parse(r.finishedAt) - Date.parse(r.startedAt)) },
            ]}
          />
        </Panel>
      </div>

      <Panel title={`${r.cases.length} cases`} bodyClassName="p-0">
        <div className={tableClass.wrap}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>Case</th>
                <th className={tableClass.th}>Kind</th>
                {r.planSource === "generated" && <th className={tableClass.th}>Plan</th>}
                <th className={tableClass.th}>Expected</th>
                <th className={tableClass.th}>Actual</th>
                <th className={tableClass.th}>Repro</th>
                <th className={tableClass.th}>Root cause</th>
                <th className={tableClass.th}>Fix</th>
                <th className={tableClass.th}>Result</th>
              </tr>
            </thead>
            <tbody>
              {r.cases.map((c) => {
                const investigation = investigations.get(c.id);
                return (
                  <tr key={c.id} className={tableClass.tr}>
                    <td className={tableClass.td}>
                      {investigation === undefined ? (
                        <span className="font-mono text-[12px] text-fg">{c.id}</span>
                      ) : (
                        <Link href={`/investigations/${investigation}`} className="font-mono text-[12px] font-medium text-accent hover:underline">
                          {c.id}
                        </Link>
                      )}
                      {c.mismatches.length > 0 && <div className="text-[11px] text-critical">{c.mismatches.join("; ")}</div>}
                    </td>
                    <td className={`${tableClass.td} text-[12px] text-muted`}>{c.kind}</td>
                    {r.planSource === "generated" && (
                      <td className={`${tableClass.td} font-mono text-[11px] text-muted`} title={c.generation?.detail ?? undefined}>
                        {c.generation?.status.replace("_", " ").toUpperCase() ?? "—"}
                      </td>
                    )}
                    <td className={tableClass.td}>
                      <OutcomePill outcome={c.expected.outcome} size="xs" />
                    </td>
                    <td className={tableClass.td}>
                      <OutcomePill outcome={c.actual.outcome} size="xs" />
                    </td>
                    <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{c.reproduction ?? "—"}</td>
                    <td className={tableClass.td}>
                      <NotImplemented size="xs" />
                    </td>
                    <td className={tableClass.td}>
                      <NotImplemented size="xs" />
                    </td>
                    <td className={tableClass.td}>
                      <StatusPill status={c.passed ? "PASS" : "FAIL"} tone={c.passed ? "positive" : "critical"} size="xs" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
