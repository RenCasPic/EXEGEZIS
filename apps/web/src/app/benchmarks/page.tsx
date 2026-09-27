import { Beaker, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { EmptyState, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { ReplayTag, SourceTag, StatusPill } from "@/components/ui/status";
import { getIndex, getRootCauses } from "@/lib/evidence/investigations";
import { latestPerCase } from "@/lib/evidence/root-causes";
import { getFormat } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("benchmarks.list"))("metaTitle") };
}

export default async function BenchmarksPage() {
  const [index, rootCauses, t, f] = await Promise.all([getIndex(), getRootCauses(), getTranslations("benchmarks.list"), getFormat()]);
  const latestRootCauses = latestPerCase(rootCauses).flatMap((e) => (e.report.status === "ok" ? [{ report: e.report.value, evaluation: e.evaluation }] : []));
  const rcFalse = latestRootCauses.filter((r) => r.evaluation?.falseValidation === true).length;
  const runs = index.benchmarks.flatMap((b) => (b.result.status === "ok" ? [{ ref: b, r: b.result.value }] : []));
  const broken = index.benchmarks.filter((b) => b.result.status !== "ok");
  // Runs that replay recorded planner responses (mock) are listed, but never counted as results.
  const isReplayRun = (r: (typeof runs)[number]["r"]) => r.planner?.provider === "mock";
  const live = runs.filter((x) => !isReplayRun(x.r));
  const replays = runs.length - live.length;
  const sum = (f: (r: (typeof runs)[number]["r"]) => number) => live.reduce((n, x) => n + f(x.r), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Stat
          label={t("runs")}
          value={live.length}
          hint={replays > 0 ? t("runsHintReplays", { archived: live.filter((x) => x.ref.archived).length, replays }) : t("runsHint", { archived: live.filter((x) => x.ref.archived).length })}
        />
        <Stat label={t("cases")} value={sum((r) => r.summary.total)} hint={t("casesHint", { count: sum((r) => r.summary.passed) })} />
        <Stat label={t("verified")} value={sum((r) => r.summary.truePositives)} hint={t("verifiedHint", { count: sum((r) => r.summary.falseNegatives) })} />
        <Stat
          label={t("falseVerified")}
          value={<span className={sum((r) => r.summary.falsePositives) === 0 ? "text-fg" : "text-bad"}>{sum((r) => r.summary.falsePositives)}</span>}
          hint={t("falseVerifiedHint")}
        />
        <Stat
          label={t("falseValidations")}
          value={<span className={rcFalse === 0 ? "text-fg" : "text-bad"}>{rcFalse}</span>}
          hint={
            <Link href="/verification/root-causes" className="text-accent-text hover:underline">
              {t("falseValidationsHint", { validated: latestRootCauses.filter((r) => r.report.decision.status === "VALIDATED").length, total: latestRootCauses.length })}
            </Link>
          }
        />
      </div>

      <Panel title={t("count", { count: runs.length })} icon={<Beaker />} bodyClassName="p-0">
        {runs.length === 0 ? (
          <EmptyState title={t("none")}>{t("noneBody", { a: "pnpm exegezis benchmark --suite buggy-shop", b: "--suite buggy-shop-ai --planner anthropic" })}</EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>{t("colRun")}</th>
                  <th className={tableClass.th}>{t("colPlans")}</th>
                  <th className={tableClass.th}>{t("colResult")}</th>
                  <th className={tableClass.th}>TP / FN</th>
                  <th className={tableClass.th}>FP / TN</th>
                  <th className={tableClass.th}>{t("colInconclusive")}</th>
                  <th className={tableClass.th}>{t("colSource")}</th>
                  <th className={tableClass.th}>{t("colFinished")}</th>
                  <th className={tableClass.th} aria-label={t("colRun")} />
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
                        t("humanWritten")
                      ) : (
                        <>
                          B ·{" "}
                          {isReplayRun(r) ? <ReplayTag title={t("replayTitle")} /> : (r.planner?.model ?? r.planner?.provider)}{" "}
                          <span className="font-mono text-faint">{r.planner?.promptVersion}</span>
                          <div className="text-[11px] text-faint">{r.planner?.examples === true ? t("withExamples") : t("noExamples")}</div>
                        </>
                      )}
                    </td>
                    <td className={tableClass.td}>
                      <StatusPill status={t("passed", { passed: r.summary.passed, total: r.summary.total })} tone={r.summary.failed === 0 ? "ok" : "bad"} size="xs" />
                    </td>
                    <td className={`${tableClass.td} font-mono text-[12px]`}>
                      {r.summary.truePositives} / {r.summary.falseNegatives}
                    </td>
                    <td className={`${tableClass.td} font-mono text-[12px]`}>
                      <span className={r.summary.falsePositives > 0 ? "text-bad" : ""}>{r.summary.falsePositives}</span> / {r.summary.trueNegatives}
                    </td>
                    <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{f.percent(r.metrics.inconclusiveRate, 1)}</td>
                    <td className={tableClass.td}>
                      <SourceTag kind={ref.archived ? "archived" : "real"} />
                    </td>
                    <td className={`${tableClass.td} whitespace-nowrap text-muted`} title={f.absolute(r.finishedAt)}>
                      {f.relative(r.finishedAt)}
                    </td>
                    <td className={`${tableClass.td} w-8`}>
                      <Link href={`/benchmarks/${ref.id}`} aria-label={t("open", { id: ref.id })} className="text-faint hover:text-fg">
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
        <p className="text-xs text-bad">
          {t("broken", { count: broken.length })} {broken.map((b) => b.relDir).join(", ")}
        </p>
      )}
    </div>
  );
}
