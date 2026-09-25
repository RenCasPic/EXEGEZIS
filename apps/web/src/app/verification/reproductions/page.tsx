import { Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Reproduction } from "@/components/tables/investigations-table";
import { EmptyState, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { OutcomePill, SourceTag, StatusPill } from "@/components/ui/status";
import { getSummaries } from "@/lib/evidence/investigations";
import { absoluteTime, relativeTime } from "@/lib/format";
import { getScope, inScope } from "@/lib/scope";

export const metadata: Metadata = { title: "Reproductions" };

const TEST_TONE = { failed: "critical", passed: "neutral", error: "warning", not_run: "neutral" } as const;

export default async function ReproductionsPage() {
  const [all, scope] = await Promise.all([getSummaries(), getScope()]);
  const rows = all.filter((s) => inScope(s, scope) && s.reproduction !== null);
  const reproduced = rows.filter((s) => s.reproduction?.status === "REPRODUCED").length;
  const runs = rows.reduce((n, s) => n + (s.reproduction?.attempts ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Reproductions" description="Every executed plan: how many attempts failed the expectation, and whether the compiled Playwright test agreed." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Executed plans" value={rows.length} />
        <Stat label="Reproduced" value={reproduced} hint="every attempt failed identically" />
        <Stat label="Browser runs" value={runs} hint="attempts across all reproductions" />
        <Stat label="Verified" value={rows.filter((s) => s.outcome === "VERIFIED").length} hint="all six criteria met" />
      </div>
      <Panel title={`${rows.length} reproductions`} icon={<Repeat />} bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState title="No executed plans yet">Run a verification from the CLI or start an investigation.</EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>Bug</th>
                  <th className={tableClass.th}>Verdict</th>
                  <th className={tableClass.th}>Reproduction</th>
                  <th className={tableClass.th}>Status</th>
                  <th className={tableClass.th}>Playwright test</th>
                  <th className={tableClass.th}>Evidence</th>
                  <th className={tableClass.th}>Last verified</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.ref.id} className={tableClass.tr}>
                    <td className={`${tableClass.td} max-w-[24rem]`}>
                      <Link href={`/investigations/${s.ref.id}#reproduction`} className="block truncate font-medium text-fg hover:underline">
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
                    <td className={`${tableClass.td} font-mono text-[11px] text-muted`}>{s.reproduction?.status.replace("_", " ")}</td>
                    <td className={tableClass.td}>
                      {s.compiledTest === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        <StatusPill status={s.compiledTest.replace("_", " ").toUpperCase()} tone={TEST_TONE[s.compiledTest]} size="xs" />
                      )}
                    </td>
                    <td className={tableClass.td}>
                      {s.evidenceOnDisk ? (
                        <Link href={`/investigations/${s.ref.id}#evidence`} className="text-[12px] text-accent hover:underline">
                          Open
                        </Link>
                      ) : (
                        <SourceTag kind="archived" />
                      )}
                    </td>
                    <td className={`${tableClass.td} whitespace-nowrap text-muted`} title={absoluteTime(s.createdAt)}>
                      {relativeTime(s.createdAt)}
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
