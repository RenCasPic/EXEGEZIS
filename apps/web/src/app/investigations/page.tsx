import { Plus, SearchX } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { FilterForm } from "@/components/ui/filter-form";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InvestigationsTable } from "@/components/tables/investigations-table";
import { ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { getSummaries } from "@/lib/evidence/investigations";
import { matchesQuery, matchesStatus, parseStatusFilter, STATUS_FILTERS } from "@/lib/filters";
import { getFormat } from "@/i18n/server";
import { listJobs } from "@/lib/jobs";
import { getScope, inScope } from "@/lib/scope";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("investigations.list"))("title") };
}

const SOURCES = [{ id: "all" }, { id: "adhoc" }, { id: "benchmark" }] as const;

export default async function InvestigationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const status = parseStatusFilter(one(params.status));
  const q = one(params.q) ?? "";
  const source = SOURCES.some((s) => s.id === one(params.source)) ? (one(params.source) as (typeof SOURCES)[number]["id"]) : "all";

  const [all, scope, jobs, t, common, f] = await Promise.all([getSummaries(), getScope(), listJobs(), getTranslations("investigations.list"), getTranslations("common"), getFormat()]);
  const scoped = all.filter((s) => inScope(s, scope));
  const bySource = scoped.filter((s) => source === "all" || (source === "benchmark") === (s.ref.kind === "benchmark-case"));
  const rows = bySource.filter((s) => matchesStatus(s, status) && matchesQuery(s, q));
  // Jobs still waiting for their first artifact have no investigation directory yet.
  const pendingJobs = status === "active" || status === "all" ? jobs.filter((j) => j.job.kind === "ai-verify" && j.status === "running" && !scoped.some((s) => s.job?.id === j.job.id)) : [];

  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ ...(status === "all" ? {} : { status }), ...(q === "" ? {} : { q }), ...(source === "all" ? {} : { source }), ...patch });
    for (const [k, v] of [...next.entries()]) if (v === "" || v === "all") next.delete(k);
    const s = next.toString();
    return s === "" ? "/investigations" : `/investigations?${s}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <ButtonLink href="/investigations/new" variant="primary">
            <Plus /> {t("new")}
          </ButtonLink>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => {
            const count = f.id === "active" ? jobs.filter((j) => j.job.kind === "ai-verify" && j.status === "running").length : bySource.filter((s) => matchesStatus(s, f.id) && matchesQuery(s, q)).length;
            return (
              <Link
                key={f.id}
                href={href({ status: f.id })}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px]",
                  f.id === status ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
                )}
              >
                {common(`statusFilter.${f.id}`)}
                <span className="font-mono text-[11px] text-faint">{count}</span>
              </Link>
            );
          })}
        </div>
        <Suspense>
          <FilterForm
            textLabel={t("search")}
            placeholder={t("searchPlaceholder")}
            hidden={status === "all" ? {} : { status }}
            selects={[{ name: "source", label: t("source"), options: SOURCES.map((x) => ({ value: x.id === "all" ? "" : x.id, label: t(`sources.${x.id}`) })) }]}
          />
        </Suspense>
      </div>

      {pendingJobs.length > 0 && (
        <Panel title={t("starting")} subtitle={t("startingSubtitle")} bodyClassName="p-0">
          <ul>
            {pendingJobs.map(({ job }) => (
              <li key={job.id} className="border-b border-line last:border-b-0">
                <Link href={`/jobs/${job.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                  <StatusPill status="RUNNING" tone="running" size="xs" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg" translate="no">
                    {job.kind === "ai-verify" ? job.symptom : job.url}
                  </span>
                  <span className="text-xs text-faint">{f.relative(job.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={t("count", { count: rows.length })} bodyClassName="p-0">
        <InvestigationsTable
          rows={rows}
          columns={["project", "status", "reproduction", "rootCause", "fix", "created"]}
          empty={
            <EmptyState icon={<SearchX />} title={t("nothing")}>
              {status === "active" ? t("noneRunning") : t("tryAnother")}
            </EmptyState>
          }
        />
      </Panel>
    </div>
  );
}
