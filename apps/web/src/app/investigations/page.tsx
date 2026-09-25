import { Plus, Search, SearchX } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { InvestigationsTable } from "@/components/tables/investigations-table";
import { ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { getSummaries } from "@/lib/evidence/investigations";
import { matchesQuery, matchesStatus, parseStatusFilter, STATUS_FILTERS } from "@/lib/filters";
import { relativeTime } from "@/lib/format";
import { listJobs } from "@/lib/jobs";
import { getScope, inScope } from "@/lib/scope";

export const metadata: Metadata = { title: "Investigations" };

const SOURCES = [
  { id: "all", label: "All sources" },
  { id: "adhoc", label: "Ad-hoc runs" },
  { id: "benchmark", label: "Benchmark cases" },
] as const;

export default async function InvestigationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const status = parseStatusFilter(one(params.status));
  const q = one(params.q) ?? "";
  const source = SOURCES.some((s) => s.id === one(params.source)) ? (one(params.source) as (typeof SOURCES)[number]["id"]) : "all";

  const [all, scope, jobs] = await Promise.all([getSummaries(), getScope(), listJobs()]);
  const scoped = all.filter((s) => inScope(s, scope));
  const bySource = scoped.filter((s) => source === "all" || (source === "benchmark") === (s.ref.kind === "benchmark-case"));
  const rows = bySource.filter((s) => matchesStatus(s, status) && matchesQuery(s, q));
  // Jobs still waiting for their first artifact have no investigation directory yet.
  const pendingJobs = status === "active" || status === "all" ? jobs.filter((j) => j.status === "running" && !scoped.some((s) => s.job?.id === j.job.id)) : [];

  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ ...(status === "all" ? {} : { status }), ...(q === "" ? {} : { q }), ...(source === "all" ? {} : { source }), ...patch });
    for (const [k, v] of [...next.entries()]) if (v === "" || v === "all") next.delete(k);
    const s = next.toString();
    return s === "" ? "/investigations" : `/investigations?${s}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Investigations"
        description="Every verification EXEGEZIS has recorded: ad-hoc runs and benchmark cases, newest first."
        actions={
          <ButtonLink href="/investigations/new" variant="primary">
            <Plus /> New Investigation
          </ButtonLink>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => {
            const count = f.id === "active" ? jobs.filter((j) => j.status === "running").length : bySource.filter((s) => matchesStatus(s, f.id) && matchesQuery(s, q)).length;
            return (
              <Link
                key={f.id}
                href={href({ status: f.id })}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px]",
                  f.id === status ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
                )}
              >
                {f.label}
                <span className="font-mono text-[11px] text-faint">{count}</span>
              </Link>
            );
          })}
        </div>
        <form className="flex items-center gap-2" action="/investigations">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <select name="source" defaultValue={source} className="h-8 rounded-md border border-line bg-panel px-2 text-[13px] text-fg">
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-panel px-2.5">
            <Search className="size-3.5 text-faint" />
            <input name="q" defaultValue={q} placeholder="Search title, symptom, id…" className="w-56 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint" />
          </label>
          <button type="submit" className="h-8 rounded-md border border-line-strong bg-panel-2 px-3 text-[13px] text-fg hover:bg-hover">
            Apply
          </button>
        </form>
      </div>

      {pendingJobs.length > 0 && (
        <Panel title="Starting" subtitle="Started from the UI; waiting for the first artifacts" bodyClassName="p-0">
          <ul>
            {pendingJobs.map(({ job }) => (
              <li key={job.id} className="border-b border-line last:border-b-0">
                <Link href={`/jobs/${job.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                  <StatusPill status="RUNNING" tone="running" size="xs" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{job.symptom}</span>
                  <span className="text-xs text-faint">{relativeTime(job.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`${rows.length} investigation${rows.length === 1 ? "" : "s"}`} bodyClassName="p-0">
        <InvestigationsTable
          rows={rows}
          columns={["project", "status", "reproduction", "rootCause", "fix", "created"]}
          empty={
            <EmptyState icon={<SearchX />} title="Nothing matches these filters">
              {status === "active"
                ? "No investigation is running. Only runs started from this UI are tracked while they run."
                : "Try another status, source or search term."}
            </EmptyState>
          }
        />
      </Panel>
    </div>
  );
}
