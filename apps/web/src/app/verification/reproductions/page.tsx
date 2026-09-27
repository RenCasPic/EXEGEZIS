import { Repeat } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Reproduction } from "@/components/tables/investigations-table";
import { EmptyState, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { OutcomePill, SourceTag, StatusPill } from "@/components/ui/status";
import { getSummaries } from "@/lib/evidence/investigations";
import { getFormat } from "@/i18n/server";
import { getScope, inScope } from "@/lib/scope";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("reproductions"))("title") };
}

const TEST_TONE = { failed: "bad", passed: "q", error: "warn", not_run: "q" } as const;

export default async function ReproductionsPage() {
  const [all, scope, t, f] = await Promise.all([getSummaries(), getScope(), getTranslations("reproductions"), getFormat()]);
  const rows = all.filter((s) => inScope(s, scope) && s.reproduction !== null);
  const reproduced = rows.filter((s) => s.reproduction?.status === "REPRODUCED").length;
  const runs = rows.reduce((n, s) => n + (s.reproduction?.attempts ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("executed")} value={rows.length} />
        <Stat label={t("reproduced")} value={reproduced} hint={t("reproducedHint")} />
        <Stat label={t("browserRuns")} value={runs} hint={t("browserRunsHint")} />
        <Stat label={t("verified")} value={rows.filter((s) => s.outcome === "VERIFIED").length} hint={t("verifiedHint")} />
      </div>
      <Panel title={t("count", { count: rows.length })} icon={<Repeat />} bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState title={t("none")}>{t("noneBody")}</EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>{t("colBug")}</th>
                  <th className={tableClass.th}>{t("colVerdict")}</th>
                  <th className={tableClass.th}>{t("colReproduction")}</th>
                  <th className={tableClass.th}>{t("colStatus")}</th>
                  <th className={tableClass.th}>{t("colTest")}</th>
                  <th className={tableClass.th}>{t("colEvidence")}</th>
                  <th className={tableClass.th}>{t("colLast")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.ref.id} className={tableClass.tr}>
                    <td className={`${tableClass.td} max-w-[24rem]`}>
                      <Link href={`/investigations/${s.ref.id}#reproduction`} className="block truncate font-medium text-fg hover:underline" translate="no">
                        {s.title}
                      </Link>
                      <span className="font-mono text-[11px] text-faint">{s.ref.caseId ?? s.planId}</span>
                    </td>
                    <td className={tableClass.td}>
                      <OutcomePill outcome={s.outcome} size="xs" />
                    </td>
                    <td className={tableClass.td}>
                      <Reproduction s={s} />
                    </td>
                    <td className={tableClass.td}>{s.reproduction !== null && <StatusPill status={s.reproduction.status} tone="q" size="xs" />}</td>
                    <td className={tableClass.td}>
                      {s.compiledTest === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <StatusPill status={s.compiledTest.toUpperCase()} tone={TEST_TONE[s.compiledTest]} size="xs" />
                      )}
                    </td>
                    <td className={tableClass.td}>
                      {s.evidenceOnDisk ? (
                        <Link href={`/investigations/${s.ref.id}#evidence`} className="text-[12px] text-accent-text hover:underline">
                          {t("open")}
                        </Link>
                      ) : (
                        <SourceTag kind="archived" />
                      )}
                    </td>
                    <td className={`${tableClass.td} whitespace-nowrap text-muted`} title={f.absolute(s.createdAt)}>
                      {f.relative(s.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
