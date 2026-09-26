import { FolderGit2, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Meta, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { NotImplemented, StatusPill } from "@/components/ui/status";
import { getSummaries } from "@/lib/evidence/investigations";
import { relativeTime } from "@/lib/format";
import { environmentOf, listProjects } from "@/lib/projects";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const [projects, summaries] = await Promise.all([listProjects(), getSummaries()]);
  const unassigned = summaries.filter((s) => s.project === null).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Projects"
        description="Target applications found in this repository (examples/*), with the benchmark suites that start them."
        actions={
          <Sheet variant="primary" trigger={<><Plus /> Add Project</>} title="Add a project">
            <div className="flex flex-col gap-4 text-[13px] text-muted">
              <div className="flex items-center gap-2">
                <span className="text-fg">Adding projects from the UI</span> <NotImplemented size="xs" />
              </div>
              <p>There is no project registry, repository connection or deployment configuration yet. A project is a target application in this repository:</p>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>
                  Put the application in <Mono>examples/&lt;name&gt;/</Mono> with a <Mono>package.json</Mono>.
                </li>
                <li>
                  Optionally add a benchmark suite in <Mono>benchmarks/&lt;suite&gt;/suite.json</Mono> whose <Mono>app.cwd</Mono> points to it.
                </li>
                <li>
                  Or point any investigation at a running URL: <Mono>pnpm exegezis ai-verify --symptom &quot;…&quot; --base-url http://…</Mono>
                </li>
              </ol>
              <p>GitHub connection, OAuth and repository analysis are not implemented.</p>
            </div>
          </Sheet>
        }
      />
      {projects.length === 0 ? (
        <Panel title="No projects">
          <EmptyState icon={<FolderGit2 />} title="No target applications in examples/" />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((p) => {
            const own = summaries.filter((s) => s.project === p.id);
            const envs = [...new Set(own.map((s) => environmentOf(s.target)).filter((e) => e !== null))];
            const last = own[0]?.createdAt ?? null;
            return (
              <Panel key={p.id} title={p.name} icon={<FolderGit2 />} subtitle={p.path}>
                {p.description !== null && <p className="mb-4 text-[13px] text-muted">{p.description}</p>}
                <Meta
                  items={[
                    { label: "Environments", value: envs.length === 0 ? "—" : envs.join(", ") },
                    { label: "Browser runtime", value: "Playwright · Chromium" },
                    { label: "Investigations", value: `${own.length} (${own.filter((s) => s.outcome === "VERIFIED").length} verified)` },
                    { label: "Last activity", value: relativeTime(last) },
                    { label: "Repository", value: <span className="flex items-center gap-2">this monorepo <NotImplemented size="xs" /></span> },
                  ]}
                />
                {p.suites.length > 0 && (
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="text-[11px] font-medium text-faint">Benchmark suites</div>
                    {p.suites.map((s) => (
                      <div key={s.id} className="rounded-md border border-line px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] text-fg">{s.id}</span>
                          <StatusPill status={s.planSource === "human" ? "HUMAN PLANS" : "AI PLANS"} tone="q" size="xs" />
                          <span className="text-xs text-faint">{s.cases} cases</span>
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-faint">starts: {s.command}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4">
                  <Link href="/investigations" className="text-xs text-accent-text hover:underline">
                    View investigations →
                  </Link>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
      {unassigned > 0 && <p className="text-xs text-faint">{unassigned} investigation(s) are not linked to a project (started from the CLI without a benchmark suite).</p>}
    </div>
  );
}
