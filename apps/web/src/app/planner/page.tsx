import { Bot } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PLANNER_V1 } from "@exegezis/planner";
import { EmptyState, Mono, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { OutcomePill, ReplayTag, StatusPill } from "@/components/ui/status";
import { isReplay } from "@/lib/evidence/cases";
import { getSummaries } from "@/lib/evidence/investigations";
import { median } from "@/lib/format";
import { getFormat } from "@/i18n/server";
import { getScope, inScope } from "@/lib/scope";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("planner"))("title") };
}

const GEN_TONE = { generated: "ok", declined: "warn", invalid_generation: "bad", error: "off" } as const;

export default async function PlannerPage() {
  const [all, scope, t, f] = await Promise.all([getSummaries(), getScope(), getTranslations("planner"), getFormat()]);
  const rows = all.filter((s) => inScope(s, scope) && s.generation !== null);
  // Replayed (mock) responses are listed but never counted as model calls, latencies or tokens.
  const live = rows.filter((s) => !isReplay(s));
  const replays = rows.length - live.length;
  const count = (status: string) => live.filter((s) => s.generation?.status === status).length;
  const latencies = live.map((s) => s.generation?.latencyMs ?? null).filter((v) => v !== null);
  const tokensIn = live.reduce((n, s) => n + (s.generation?.inputTokens ?? 0), 0);
  const tokensOut = live.reduce((n, s) => n + (s.generation?.outputTokens ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={
          <>
            {t("description")} <Mono>{PLANNER_V1.version}</Mono>.
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t("calls")} value={live.length} hint={replays > 0 ? t("callsReplays", { count: replays }) : t("callsLive")} />
        <Stat label={t("generated")} value={count("generated")} />
        <Stat label={t("declined")} value={count("declined")} hint={t("declinedHint")} />
        <Stat label={t("invalid")} value={count("invalid_generation") + count("error")} hint={t("invalidHint")} />
        <Stat label={t("median")} value={f.duration(median(latencies))} hint={t("tokens", { input: f.number(tokensIn), output: f.number(tokensOut) })} />
      </div>
      <Panel title={t("count", { count: rows.length })} icon={<Bot />} bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState title={t("none")}>{t("noneBody")}</EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>{t("colSymptom")}</th>
                  <th className={tableClass.th}>{t("colPlanner")}</th>
                  <th className={tableClass.th}>{t("colModel")}</th>
                  <th className={tableClass.th}>{t("colExamples")}</th>
                  <th className={tableClass.th}>{t("colLatency")}</th>
                  <th className={tableClass.th}>{t("colTokens")}</th>
                  <th className={tableClass.th}>{t("colVerdict")}</th>
                  <th className={tableClass.th}>{t("colWhen")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const g = s.generation;
                  if (g === null) return null;
                  return (
                    <tr key={s.ref.id} className={tableClass.tr}>
                      <td className={`${tableClass.td} max-w-[26rem]`} translate="no">
                        <Link href={`/investigations/${s.ref.id}#plan`} className="block truncate text-fg hover:underline" title={s.symptom ?? undefined}>
                          {s.symptom ?? s.title}
                        </Link>
                        <span className="block truncate text-[11px] text-faint" title={g.detail ?? undefined}>
                          {g.detail}
                        </span>
                      </td>
                      <td className={tableClass.td}>
                        <span className="flex flex-wrap items-center gap-1">
                          <StatusPill status={g.status.toUpperCase()} tone={GEN_TONE[g.status]} size="xs" />
                          {isReplay(s) && <ReplayTag title={t("replayTitle")} />}
                        </span>
                      </td>
                      <td className={`${tableClass.td} font-mono text-[11px] text-muted`}>
                        {g.model ?? g.provider ?? "—"} · {g.promptVersion}
                      </td>
                      <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{g.examples ?? "—"}</td>
                      <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{isReplay(s) ? "—" : f.duration(g.latencyMs)}</td>
                      <td className={`${tableClass.td} whitespace-nowrap font-mono text-[11px] text-muted`}>
                        {g.inputTokens === null ? "—" : `${g.inputTokens} / ${g.outputTokens ?? 0}`}
                      </td>
                      <td className={tableClass.td}>
                        <OutcomePill outcome={s.outcome} size="xs" />
                      </td>
                      <td className={`${tableClass.td} whitespace-nowrap text-muted`}>{f.relative(s.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
