import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { NotImplemented, OutcomePill, ReplayTag, SourceTag, StatusPill, VerdictPill } from "@/components/ui/status";
import { tableClass } from "@/components/ui/primitives";
import type { InvestigationSummary } from "@/lib/evidence/investigations";
import { isReplay } from "@/lib/evidence/cases";
import { isExpectedNegative } from "@/lib/filters";
import { useFormat } from "@/i18n/client";
import { shortReason } from "@/lib/reasons";

function Status({ s }: { s: InvestigationSummary }) {
  const t = useTranslations("investigations.table");
  const common = useTranslations("common.shortReason");
  if (s.job?.status === "running" && s.outcome === null) return <StatusPill status="RUNNING" tone="running" size="xs" />;
  if (s.outcome === null && s.generation !== null) {
    const tone = s.generation.status === "generated" ? "q" : s.generation.status === "declined" ? "warn" : "bad";
    return <StatusPill status={s.generation.status === "generated" ? "PLAN_ONLY" : s.generation.status.toUpperCase()} tone={tone} size="xs" />;
  }
  const why = shortReason(s.outcome, s.outcomeReason);
  return (
    <span className="flex flex-col items-start gap-0.5">
      <OutcomePill outcome={s.outcome} size="xs" />
      {why !== null && (
        <span className="text-[11px] text-muted">{common(why)}</span>
      )}
      {isExpectedNegative(s) && <span className="text-[11px] text-muted">{t("expectedNegative")}</span>}
    </span>
  );
}

/** The latest root-cause investigation of this bug, linked; NOT RUN when there is none. */
function RootCause({ s }: { s: InvestigationSummary }) {
  const t = useTranslations("investigations.table");
  const status = useTranslations("labels.status");
  if (s.rootCause === null) return <StatusPill status="NOT_RUN" tone="q" size="xs" title={t("noRootCause")} />;
  return (
    <Link href={`/verification/root-causes/${s.rootCause.entryId}`} className="inline-flex flex-col items-start gap-0.5 hover:underline">
      <VerdictPill verdict={s.rootCause.status} size="xs" />
      <span className="text-[11px] text-muted">{t("evidenceLevel", { level: status(s.rootCause.evidenceLevel).toLowerCase() })}</span>
    </Link>
  );
}

export function Reproduction({ s }: { s: InvestigationSummary }) {
  const f = useFormat();
  if (s.reproduction === null) return <span className="text-faint">—</span>;
  const r = s.reproduction;
  return (
    <span className="font-mono text-[12px] text-fg">
      {r.failures}/{r.attempts}
      <span className="ml-1.5 text-faint">{f.percent(r.rate)}</span>
    </span>
  );
}

export function InvestigationsTable({
  rows,
  columns = ["project", "status", "reproduction", "rootCause", "fix", "created"],
  empty,
}: {
  rows: InvestigationSummary[];
  columns?: ("project" | "status" | "reproduction" | "rootCause" | "fix" | "created" | "source")[];
  empty?: React.ReactNode;
}) {
  const t = useTranslations("investigations.table");
  const f = useFormat();
  if (rows.length === 0) return <>{empty}</>;
  const has = (c: (typeof columns)[number]) => columns.includes(c);
  return (
    <div className={tableClass.wrap}>
      <table className={tableClass.table}>
        <thead>
          <tr>
            <th className={tableClass.th}>{t("investigation")}</th>
            {has("source") && <th className={tableClass.th}>{t("source")}</th>}
            {has("project") && <th className={tableClass.th}>{t("project")}</th>}
            {has("status") && <th className={tableClass.th}>{t("status")}</th>}
            {has("reproduction") && <th className={tableClass.th}>{t("reproduction")}</th>}
            {has("rootCause") && <th className={tableClass.th}>{t("rootCause")}</th>}
            {has("fix") && <th className={tableClass.th}>{t("fix")}</th>}
            {has("created") && <th className={tableClass.th}>{t("created")}</th>}
            <th className={tableClass.th} aria-label={t("open")} />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.ref.id} className={tableClass.tr}>
              <td className={`${tableClass.td} max-w-[28rem]`}>
                <Link href={`/investigations/${s.ref.id}`} className="block min-w-0 hover:underline hover:decoration-line-strong hover:underline-offset-4">
                  <span className="block truncate font-medium text-fg" translate="no">
                    {s.title}
                  </span>
                </Link>
                <span className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-faint">
                  <span className="truncate">{s.ref.caseId ?? s.planId ?? s.ref.id}</span>
                  <span>·</span>
                  <span className="shrink-0">{t(`kind.${s.ref.kind}`)}</span>
                  {isReplay(s) && <ReplayTag title={t("replayTitle")} />}
                </span>
              </td>
              {has("source") && (
                <td className={tableClass.td}>
                  <SourceTag kind={s.ref.archived ? "archived" : "real"} />
                </td>
              )}
              {has("project") && <td className={`${tableClass.td} text-muted`}>{s.project ?? <span className="text-faint">{t("unassigned")}</span>}</td>}
              {has("status") && (
                <td className={tableClass.td}>
                  <Status s={s} />
                </td>
              )}
              {has("reproduction") && (
                <td className={tableClass.td}>
                  <Reproduction s={s} />
                </td>
              )}
              {has("rootCause") && (
                <td className={tableClass.td}>
                  <RootCause s={s} />
                </td>
              )}
              {has("fix") && (
                <td className={tableClass.td}>
                  <NotImplemented size="xs" />
                </td>
              )}
              {has("created") && (
                <td className={`${tableClass.td} whitespace-nowrap text-muted`} title={f.absolute(s.createdAt)}>
                  {f.relative(s.createdAt)}
                </td>
              )}
              <td className={`${tableClass.td} w-8`}>
                <Link href={`/investigations/${s.ref.id}`} aria-label={t("openTitle", { title: s.title })} className="text-faint hover:text-fg">
                  <ChevronRight className="size-4" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
