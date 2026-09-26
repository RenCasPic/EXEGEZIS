import { Bot } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PLANNER_V1 } from "@exegezis/planner";
import { EmptyState, Mono, PageHeader, Panel, Stat, tableClass } from "@/components/ui/primitives";
import { OutcomePill, ReplayTag, StatusPill } from "@/components/ui/status";
import { isReplay } from "@/lib/evidence/cases";
import { getSummaries } from "@/lib/evidence/investigations";
import { duration, median, relativeTime } from "@/lib/format";
import { getScope, inScope } from "@/lib/scope";

export const metadata: Metadata = { title: "AI plans" };

const GEN_TONE = { generated: "ok", declined: "warn", invalid_generation: "bad", error: "off" } as const;

export default async function PlannerPage() {
  const [all, scope] = await Promise.all([getSummaries(), getScope()]);
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
        title="AI Plans"
        description={
          <>
            Every planner call on record. The planner writes a TestPlan from a symptom, once, and never decides a verdict. Current prompt:{" "}
            <Mono>{PLANNER_V1.version}</Mono>.
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Planner calls" value={live.length} hint={replays > 0 ? `${replays} replayed responses not counted` : "live model calls"} />
        <Stat label="Generated" value={count("generated")} />
        <Stat label="Declined" value={count("declined")} hint="symptom not testable as written" />
        <Stat label="Invalid / error" value={count("invalid_generation") + count("error")} hint="never repaired, never executed" />
        <Stat label="Median latency" value={duration(median(latencies))} hint={`${tokensIn.toLocaleString("en-US")} in / ${tokensOut.toLocaleString("en-US")} out tokens total`} />
      </div>
      <Panel title={`${rows.length} generations`} icon={<Bot />} bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState title="No planner calls recorded">Start an investigation from a symptom, or run the AI benchmark.</EmptyState>
        ) : (
          <div className={tableClass.wrap}>
            <table className={tableClass.table}>
              <thead>
                <tr>
                  <th className={tableClass.th}>Symptom</th>
                  <th className={tableClass.th}>Planner</th>
                  <th className={tableClass.th}>Model · prompt</th>
                  <th className={tableClass.th}>Examples</th>
                  <th className={tableClass.th}>Latency</th>
                  <th className={tableClass.th}>Tokens</th>
                  <th className={tableClass.th}>Engine verdict</th>
                  <th className={tableClass.th}>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const g = s.generation;
                  if (g === null) return null;
                  return (
                    <tr key={s.ref.id} className={tableClass.tr}>
                      <td className={`${tableClass.td} max-w-[26rem]`}>
                        <Link href={`/investigations/${s.ref.id}#plan`} className="block truncate text-fg hover:underline" title={s.symptom ?? undefined}>
                          {s.symptom ?? s.title}
                        </Link>
                        <span className="block truncate text-[11px] text-faint" title={g.detail ?? undefined}>
                          {g.detail}
                        </span>
                      </td>
                      <td className={tableClass.td}>
                        <span className="flex flex-wrap items-center gap-1">
                          <StatusPill status={g.status.replace("_", " ").toUpperCase()} tone={GEN_TONE[g.status]} size="xs" />
                          {isReplay(s) && <ReplayTag title="Recorded planner response (mock): not a live model call">REPLAY</ReplayTag>}
                        </span>
                      </td>
                      <td className={`${tableClass.td} font-mono text-[11px] text-muted`}>
                        {g.model ?? g.provider ?? "—"} · {g.promptVersion}
                      </td>
                      <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{g.examples ?? "—"}</td>
                      <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{isReplay(s) ? "—" : duration(g.latencyMs)}</td>
                      <td className={`${tableClass.td} whitespace-nowrap font-mono text-[11px] text-muted`}>
                        {g.inputTokens === null ? "—" : `${g.inputTokens} / ${g.outputTokens ?? 0}`}
                      </td>
                      <td className={tableClass.td}>
                        <OutcomePill outcome={s.outcome} size="xs" />
                      </td>
                      <td className={`${tableClass.td} whitespace-nowrap text-muted`}>{relativeTime(s.createdAt)}</td>
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
