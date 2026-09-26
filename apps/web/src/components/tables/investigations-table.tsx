import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { NotImplemented, OutcomePill, ReplayTag, SourceTag, StatusPill, VerdictPill } from "@/components/ui/status";
import { tableClass } from "@/components/ui/primitives";
import type { InvestigationSummary } from "@/lib/evidence/investigations";
import { isReplay } from "@/lib/evidence/cases";
import { isExpectedNegative } from "@/lib/filters";
import { absoluteTime, percent, relativeTime } from "@/lib/format";
import { shortReason } from "@/lib/reasons";

const KIND_LABEL: Record<InvestigationSummary["ref"]["kind"], string> = {
  "benchmark-case": "Benchmark case",
  verification: "Verification",
  "ai-verification": "AI verification",
  "generated-plan": "Generated plan",
};

function Status({ s }: { s: InvestigationSummary }) {
  if (s.job?.status === "running" && s.outcome === null) return <StatusPill status="RUNNING" tone="running" size="xs" />;
  if (s.outcome === null && s.generation !== null) {
    const tone = s.generation.status === "generated" ? "q" : s.generation.status === "declined" ? "warn" : "bad";
    return <StatusPill status={s.generation.status === "generated" ? "PLAN ONLY" : s.generation.status.replace("_", " ").toUpperCase()} tone={tone} size="xs" />;
  }
  const why = shortReason(s.outcome, s.outcomeReason);
  return (
    <span className="flex flex-col items-start gap-0.5">
      <OutcomePill outcome={s.outcome} size="xs" />
      {why !== null && (
        <span className="text-[11px] text-muted" title={s.outcomeReason ?? undefined}>
          {why}
        </span>
      )}
      {isExpectedNegative(s) && <span className="text-[11px] text-muted">expected for this negative case</span>}
    </span>
  );
}

/** The latest root-cause investigation of this bug, linked; NOT RUN when there is none. */
function RootCause({ s }: { s: InvestigationSummary }) {
  if (s.rootCause === null) return <StatusPill status="NOT RUN" tone="q" size="xs" title="No root-cause experiment has been run for this bug (exegezis root-cause)." />;
  return (
    <Link href={`/verification/root-causes/${s.rootCause.entryId}`} className="inline-flex flex-col items-start gap-0.5 hover:underline">
      <VerdictPill verdict={s.rootCause.status} size="xs" />
      <span className="text-[11px] text-muted">evidence {s.rootCause.evidenceLevel.toLowerCase()}</span>
    </Link>
  );
}

export function Reproduction({ s }: { s: InvestigationSummary }) {
  if (s.reproduction === null) return <span className="text-faint">—</span>;
  const r = s.reproduction;
  return (
    <span className="font-mono text-[12px] text-fg" title={r.reason}>
      {r.failures}/{r.attempts}
      <span className="ml-1.5 text-faint">{percent(r.rate)}</span>
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
  if (rows.length === 0) return <>{empty}</>;
  const has = (c: (typeof columns)[number]) => columns.includes(c);
  return (
    <div className={tableClass.wrap}>
      <table className={tableClass.table}>
        <thead>
          <tr>
            <th className={tableClass.th}>Investigation</th>
            {has("source") && <th className={tableClass.th}>Source</th>}
            {has("project") && <th className={tableClass.th}>Project</th>}
            {has("status") && <th className={tableClass.th}>Status</th>}
            {has("reproduction") && <th className={tableClass.th}>Reproduction</th>}
            {has("rootCause") && <th className={tableClass.th}>Root cause</th>}
            {has("fix") && <th className={tableClass.th}>Fix</th>}
            {has("created") && <th className={tableClass.th}>Created</th>}
            <th className={tableClass.th} aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.ref.id} className={tableClass.tr}>
              <td className={`${tableClass.td} max-w-[28rem]`}>
                <Link href={`/investigations/${s.ref.id}`} className="block min-w-0 hover:underline hover:decoration-line-strong hover:underline-offset-4">
                  <span className="block truncate font-medium text-fg">{s.title}</span>
                </Link>
                <span className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-faint">
                  <span className="truncate">{s.ref.caseId ?? s.planId ?? s.ref.id}</span>
                  <span>·</span>
                  <span className="shrink-0">{KIND_LABEL[s.ref.kind]}</span>
                  {isReplay(s) && <ReplayTag title="Recorded planner response (mock): not a live AI result">REPLAY</ReplayTag>}
                </span>
              </td>
              {has("source") && (
                <td className={tableClass.td}>
                  <SourceTag kind={s.ref.archived ? "archived" : "real"} />
                </td>
              )}
              {has("project") && <td className={`${tableClass.td} text-muted`}>{s.project ?? <span className="text-faint">Unassigned</span>}</td>}
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
                <td className={`${tableClass.td} whitespace-nowrap text-muted`} title={absoluteTime(s.createdAt)}>
                  {relativeTime(s.createdAt)}
                </td>
              )}
              <td className={`${tableClass.td} w-8`}>
                <Link href={`/investigations/${s.ref.id}`} aria-label={`Open ${s.title}`} className="text-faint hover:text-fg">
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
