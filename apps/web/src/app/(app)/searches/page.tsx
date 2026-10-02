import { describeQuery, listSavedSearches } from "@exegezis/search/light";
import { Bookmark, ChevronRight, Play, Plus, Search, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { deleteSavedAction, runSavedAction } from "@/app/search-actions";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { buttonClass, ButtonLink, EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { getFormat, getUiLocale } from "@/i18n/server";
import { listSearches } from "@/lib/evidence/searches";
import { listJobs } from "@/lib/jobs";
import { SEARCH_STATUS_TONE } from "@/lib/search-labels";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("searches.list"))("title") };
}

export default async function SearchesPage() {
  const [searches, jobs, saved, t, tm, f, locale] = await Promise.all([
    listSearches(),
    listJobs(),
    listSavedSearches().catch(() => []),
    getTranslations("searches.list"),
    getTranslations("searches.mode"),
    getFormat(),
    getUiLocale(),
  ]);
  const pending = jobs.filter((j) => j.job.kind === "search" && (j.status === "running" || j.status === "queued"));

  return (
    <div className="flex flex-col gap-5">
      <AutoRefresh active={pending.length > 0} />
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <ButtonLink href="/?modo=buscar" variant="primary">
            <Plus /> {t("new")}
          </ButtonLink>
        }
      />

      {pending.length > 0 && (
        <Panel title={t("running")} bodyClassName="p-0">
          <ul>
            {pending.map(({ job, status }) => (
              <li key={job.id} className="border-b border-line last:border-b-0">
                <Link href={`/jobs/${job.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50">
                  <StatusPill status={status === "queued" ? "QUEUED" : "RUNNING"} tone={status === "queued" ? "q" : "running"} size="xs" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{job.kind === "search" ? job.url : job.id}</span>
                  <span className="text-xs text-faint">{f.relative(job.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={t("count", { count: searches.length })} icon={<Search />} bodyClassName="p-0">
        {searches.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title={t("none")}
            action={
              <ButtonLink href="/?modo=buscar" variant="primary">
                <Plus /> {t("search")}
              </ButtonLink>
            }
          >
            {t.rich("noneBody", {
              command: () => (
                <code className="font-mono" translate="no">
                  pnpm exegezis search --url https://… --terms &quot;a, b&quot;
                </code>
              ),
            })}
          </EmptyState>
        ) : (
          <ul>
            {searches.map((s) => {
              const r = s.report.status === "ok" ? s.report.value : null;
              return (
                <li key={s.id} className="border-b border-line last:border-b-0">
                  <Link href={`/searches/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12px] text-fg">{r?.target.url ?? s.relDir}</div>
                      {r === null ? (
                        <div className="text-[12px] text-bad">{t("invalid")}</div>
                      ) : (
                        <>
                          <div className="truncate text-[13px] text-fg" title={describeQuery(r, locale)}>
                            <span className="text-muted">{tm(r.query.kind)}:</span> <span translate="no">{describeQuery(r, locale)}</span>
                          </div>
                          <div className="text-[12px] text-muted">{t("line", { hits: r.summary.hits, searched: r.coverage.searched, found: r.coverage.found, when: f.relative(r.finishedAt) })}</div>
                        </>
                      )}
                    </div>
                    {r === null ? <StatusPill status="INVALID" tone="bad" size="xs" /> : <StatusPill status={r.status} tone={SEARCH_STATUS_TONE[r.status]} size="xs" />}
                    <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel id="guardadas" title={t("saved", { count: saved.length })} icon={<Bookmark />} subtitle={t("savedSubtitle")} bodyClassName="p-0">
        {saved.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-muted">{t("noSaved")}</p>
        ) : (
          <ul>
            {saved.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1 basis-60">
                  <div className="text-[13px] font-medium text-fg" translate="no">
                    {s.name}
                  </div>
                  <div className="truncate font-mono text-[12px] text-muted">{s.url}</div>
                  <div className="truncate text-[12px] text-muted">
                    {tm(s.query.kind)}: <span translate="no">{describeQuery({ query: s.query }, locale)}</span> · {s.lastRunAt === null ? t("neverRepeated") : t("lastRun", { when: f.relative(s.lastRunAt) })}
                  </div>
                </div>
                <form action={runSavedAction}>
                  <input type="hidden" name="saved" value={s.id} />
                  <button type="submit" className={buttonClass("primary", "sm")}>
                    <Play aria-hidden /> {t("repeat")}
                  </button>
                </form>
                <form action={deleteSavedAction}>
                  <input type="hidden" name="saved" value={s.id} />
                  <button type="submit" className={buttonClass("ghost", "sm")} aria-label={t("deleteSaved", { name: s.name })}>
                    <Trash2 aria-hidden /> {t("delete")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
