import { getTranslations } from "next-intl/server";
import { Suspense, type ReactNode } from "react";
import { SidebarBrand, SidebarFooter, SidebarNav } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { accountSummary } from "@/lib/account";
import { getIndex, getSummaries } from "@/lib/evidence/investigations";
import { localUser, repositoryInfo } from "@/lib/git";
import { listJobs } from "@/lib/jobs";
import { environmentOf, listProjects } from "@/lib/projects";
import { getScope, inScope, UNASSIGNED } from "@/lib/scope";
import { countByStatus } from "@/lib/filters";

/** The app's frame on every page but the home: the sidebar and the top bar (scope, search, language, theme, activity). */
export async function AppShell({ children }: { children: ReactNode }) {
  // Cloud mode: a signed-in user who accepted the legal texts (else /login or /welcome).
  const account = await accountSummary();
  const [t, status] = await Promise.all([getTranslations("shell"), getTranslations("labels.status")]);
  const [summaries, index, jobs, projects, scope, repo] = await Promise.all([getSummaries(), getIndex(), listJobs(), listProjects(), getScope(), repositoryInfo()]);
  const scoped = summaries.filter((s) => inScope(s, scope));
  const counts = countByStatus(scoped, jobs);
  const environments = [...new Set(summaries.map((s) => environmentOf(s.target)).filter((e) => e !== null))].sort();
  const user = localUser();
  const hasUnassigned = summaries.some((s) => s.project === null);

  const page = t("palette.groupPage");
  const palette = [
    { href: "/", title: t("palette.home"), group: page },
    { href: "/overview", title: t("nav.overview"), group: page },
    { href: "/inspections", title: t("nav.inspections"), group: page },
    { href: "/searches", title: t("nav.searches"), group: page },
    { href: "/investigations", title: t("nav.allInvestigations"), group: page },
    { href: "/investigations/new", title: t("palette.newInvestigation"), group: t("palette.groupAction") },
    { href: "/verification/reproductions", title: t("nav.reproductions"), group: page },
    { href: "/planner", title: t("nav.aiPlans"), group: page },
    { href: "/verification/root-causes", title: t("nav.rootCauses"), group: page },
    { href: "/benchmarks", title: t("nav.benchmarks"), group: page },
    { href: "/projects", title: t("nav.projects"), group: page },
    { href: "/settings", title: t("nav.settings"), group: page },
    ...index.benchmarks.map((b) => ({
      href: `/benchmarks/${b.id}`,
      title: `${b.result.status === "ok" ? b.result.value.suite : "benchmark"} · ${b.id}`,
      group: t("palette.groupBenchmark"),
    })),
    ...index.inspections.map((i) => ({
      href: `/inspections/${i.id}`,
      title: i.report.status === "ok" ? i.report.value.target.url : i.relDir,
      group: t("palette.groupInspection"),
      hint: i.report.status === "ok" ? status(i.report.value.status) : t("palette.invalid"),
    })),
    ...index.searches.map((s) => ({
      href: `/searches/${s.id}`,
      title: s.report.status === "ok" ? s.report.value.target.url : s.relDir,
      group: t("palette.groupSearch"),
      hint: s.report.status === "ok" ? status(s.report.value.status) : t("palette.invalid"),
    })),
    ...summaries.map((s) => ({
      href: `/investigations/${s.ref.id}`,
      title: s.title,
      group: t("palette.groupInvestigation"),
      hint: s.outcome === null ? (s.ref.caseId ?? s.ref.id) : `${s.ref.caseId ?? s.planId ?? ""} ${status(s.outcome)}`.trim(),
    })),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-bg px-3 py-4 lg:flex">
        <SidebarBrand />
        <div className="flex-1">
          <Suspense>
            <SidebarNav counts={counts} />
          </Suspense>
        </div>
        <SidebarFooter workspace={t("footer.localWorkspace")} repository={repo.name} user={user} account={account} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          projects={[...projects.map((p) => ({ id: p.id, label: p.id })), ...(hasUnassigned ? [{ id: UNASSIGNED, label: t("topbar.unassigned") }] : [])]}
          environments={environments}
          scope={scope}
          palette={palette}
          running={jobs
            .filter((j) => j.status === "running" || j.status === "queued")
            .map((j) => ({
              id: j.job.id,
              symptom:
                j.job.kind === "ai-verify"
                  ? t("topbar.jobInvestigation", { symptom: j.job.symptom })
                  : j.job.kind === "access"
                    ? t("topbar.jobAccess", { url: j.job.url })
                    : j.job.kind === "search"
                      ? t("topbar.jobSearch", { url: j.job.url })
                      : t("topbar.jobInspect", { url: j.job.url }),
              startedAt: j.job.startedAt,
            }))}
          counts={counts}
          user={user}
          account={account}
        />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
