import { ArrowLeft, Beaker, Gauge } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { join } from "node:path";
import { BenchmarkSuite } from "@exegezis/core";
import { Meta, Mono, PageHeader, Panel, tableClass } from "@/components/ui/primitives";
import { NotImplemented, OutcomePill, ReplayTag, SourceTag, StatusPill } from "@/components/ui/status";
import { findBenchmark, getIndex } from "@/lib/evidence/investigations";
import { readArtifact, valueOf } from "@/lib/evidence/read";
import { EngineText } from "@/components/ui/engine-text";
import { getFormat } from "@/i18n/server";
import { benchmarksDir } from "@/lib/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("benchmarks.detail"))("metaTitle") };
}

const METRICS = ["planValidityRate", "semanticValidityRate", "verificationSuccess", "falsePositiveRate", "inconclusiveRate", "invalidPlanRate", "reproductionRate", "anchorQuality", "selectorQuality", "playwrightAgreement"] as const;

export default async function BenchmarkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ref, t, f] = await Promise.all([findBenchmark(id), getTranslations("benchmarks.detail"), getFormat()]);
  if (ref === null) notFound();
  if (ref.result.status !== "ok") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={id} description={t("unreadable")} />
        <p className="text-[13px] text-bad">{ref.result.status === "missing" ? t("missing") : <span translate="no">{ref.result.issues.join("; ")}</span>}</p>
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
        <ArrowLeft className="size-3" /> {t("back")}
      </Link>
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <StatusPill status={`${r.summary.passed}/${r.summary.total}`} tone={r.summary.failed === 0 ? "ok" : "bad"} />
            <SourceTag kind={ref.archived ? "archived" : "real"} />
            {r.planner?.provider === "mock" && <ReplayTag title={t("replayTitle")} />}
          </div>
        }
        title={`${r.suite} · ${r.planSource === "human" ? t("benchmarkA") : r.planner?.provider === "mock" ? t("benchmarkBReplay") : t("benchmarkB")}`}
        description={suiteDef?.description === undefined ? undefined : <span translate="no">{suiteDef.description}</span>}
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Panel title={t("metrics")} icon={<Gauge />} bodyClassName="p-0">
          <div className="grid grid-cols-2 md:grid-cols-5">
            {METRICS.map((key) => (
              <div key={key} className="border-b border-r border-line p-3" title={t(`metric.${key}Hint`)}>
                <div className="text-[11px] text-muted">{t(`metric.${key}`)}</div>
                <div className="mt-1 font-mono text-[18px] font-semibold text-fg">{f.percent(r.metrics[key], 1)}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4">
            {(
              [
                ["truePositives", r.summary.truePositives],
                ["falseNegatives", r.summary.falseNegatives],
                ["falsePositives", r.summary.falsePositives],
                ["trueNegatives", r.summary.trueNegatives],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="border-r border-line p-3 last:border-r-0">
                <div className="text-[11px] text-muted">{t(key)}</div>
                <div className={`mt-1 font-mono text-[18px] font-semibold ${key === "falsePositives" && value > 0 ? "text-bad" : "text-fg"}`}>{value}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title={t("run")} icon={<Beaker />}>
          <Meta
            className="text-[12px]"
            items={[
              { label: t("run"), value: <Mono className="break-all">{id}</Mono> },
              { label: t("runsPerCase"), value: r.runsPerCase },
              { label: t("plans"), value: r.planSource === "human" ? t("humanWritten") : t("generatedFromSymptoms") },
              ...(r.planner === null
                ? []
                : [
                    { label: t("planner"), value: <Mono>{`${r.planner.provider} / ${r.planner.model ?? "—"}`}</Mono> },
                    { label: t("prompt"), value: <Mono>{r.planner.promptVersion}</Mono> },
                    { label: t("examples"), value: r.planner.examples ? t("leaveOneOut") : t("none") },
                  ]),
              { label: t("target"), value: <Mono className="break-all">{r.baseUrl}</Mono> },
              { label: t("engine"), value: `exegezis ${r.exegezisVersion}` },
              { label: t("started"), value: f.absolute(r.startedAt) },
              { label: t("took"), value: f.duration(Date.parse(r.finishedAt) - Date.parse(r.startedAt)) },
            ]}
          />
        </Panel>
      </div>

      <Panel title={t("cases", { count: r.cases.length })} bodyClassName="p-0">
        <div className={tableClass.wrap}>
          <table className={tableClass.table}>
            <thead>
              <tr>
                <th className={tableClass.th}>{t("colCase")}</th>
                <th className={tableClass.th}>{t("colKind")}</th>
                {r.planSource === "generated" && <th className={tableClass.th}>{t("colPlan")}</th>}
                <th className={tableClass.th}>{t("colExpected")}</th>
                <th className={tableClass.th}>{t("colActual")}</th>
                <th className={tableClass.th}>{t("colRepro")}</th>
                <th className={tableClass.th}>{t("colRootCause")}</th>
                <th className={tableClass.th}>{t("colFix")}</th>
                <th className={tableClass.th}>{t("colResult")}</th>
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
                        <Link href={`/investigations/${investigation}`} className="font-mono text-[12px] font-medium text-accent-text hover:underline">
                          {c.id}
                        </Link>
                      )}
                      {c.mismatches.length > 0 && (
                        <div className="text-[11px] text-bad">
                          <EngineText text={c.mismatches.join("; ")} />
                        </div>
                      )}
                    </td>
                    <td className={`${tableClass.td} text-[12px] text-muted`}>{t(`kind.${c.kind}`)}</td>
                    {r.planSource === "generated" && (
                      <td className={tableClass.td}>{c.generation === null || c.generation === undefined ? "—" : <StatusPill status={c.generation.status.toUpperCase()} tone="q" size="xs" />}</td>
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
                      <StatusPill status={c.passed ? "PASS" : "FAIL"} tone={c.passed ? "ok" : "bad"} size="xs" />
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
