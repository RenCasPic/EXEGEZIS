import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { SidebarBrand, SidebarFooter, SidebarNav } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { getIndex, getSummaries } from "@/lib/evidence/investigations";
import { label } from "@/lib/evidence/stages";
import { localUser, repositoryInfo } from "@/lib/git";
import { listJobs } from "@/lib/jobs";
import { environmentOf, listProjects } from "@/lib/projects";
import { getScope, inScope, UNASSIGNED } from "@/lib/scope";
import { countByStatus } from "@/lib/filters";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "EXEGEZIS", template: "%s · EXEGEZIS" },
  description: "Software verification: symptoms, reproductions and evidence.",
};

// Every page reads the run directories on disk at request time.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [summaries, index, jobs, projects, scope, repo] = await Promise.all([
    getSummaries(),
    getIndex(),
    listJobs(),
    listProjects(),
    getScope(),
    repositoryInfo(),
  ]);
  const scoped = summaries.filter((s) => inScope(s, scope));
  const counts = countByStatus(scoped, jobs);
  const environments = [...new Set(summaries.map((s) => environmentOf(s.target)).filter((e) => e !== null))].sort();
  const user = localUser();
  const hasUnassigned = summaries.some((s) => s.project === null);

  const palette = [
    { href: "/", title: "Inicio · inspeccionar un sitio", group: "Page" },
    { href: "/overview", title: "Overview", group: "Page" },
    { href: "/inspections", title: "Inspections", group: "Page" },
    { href: "/investigations", title: "All investigations", group: "Page" },
    { href: "/investigations/new", title: "New investigation", group: "Action" },
    { href: "/verification/reproductions", title: "Reproductions", group: "Page" },
    { href: "/planner", title: "AI plans", group: "Page" },
    { href: "/benchmarks", title: "Benchmarks", group: "Page" },
    { href: "/projects", title: "Projects", group: "Page" },
    { href: "/settings", title: "Settings", group: "Page" },
    ...index.benchmarks.map((b) => ({
      href: `/benchmarks/${b.id}`,
      title: `${b.result.status === "ok" ? b.result.value.suite : "benchmark"} · ${b.id}`,
      group: "Benchmark",
    })),
    ...index.inspections.map((i) => ({
      href: `/inspections/${i.id}`,
      title: i.report.status === "ok" ? i.report.value.target.url : i.relDir,
      group: "Inspection",
      hint: i.report.status === "ok" ? i.report.value.status : "INVALID",
    })),
    ...summaries.map((s) => ({
      href: `/investigations/${s.ref.id}`,
      title: s.title,
      group: "Investigation",
      hint: s.outcome === null ? (s.ref.caseId ?? s.ref.id) : `${s.ref.caseId ?? s.planId ?? ""} ${label(s.outcome)}`.trim(),
    })),
  ];

  return (
    // data-theme is set by the boot script before React hydrates.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-bg px-3 py-4 lg:flex">
            <SidebarBrand />
            <div className="flex-1">
              <Suspense>
                <SidebarNav counts={counts} />
              </Suspense>
            </div>
            <SidebarFooter workspace="Local workspace" repository={repo.name} user={user} />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar
              projects={[...projects.map((p) => ({ id: p.id, label: p.id })), ...(hasUnassigned ? [{ id: UNASSIGNED, label: "Unassigned" }] : [])]}
              environments={environments}
              scope={scope}
              palette={palette}
              running={jobs.filter((j) => j.status === "running" || j.status === "queued").map((j) => ({ id: j.job.id, symptom: j.job.kind === "ai-verify" ? j.job.symptom : `Inspect ${j.job.url}`, startedAt: j.job.startedAt }))}
              counts={counts}
              user={user}
            />
            <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
