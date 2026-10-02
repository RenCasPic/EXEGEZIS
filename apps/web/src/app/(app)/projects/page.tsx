import { FolderGit2, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState, Meta, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { NotImplemented } from "@/components/ui/status";
import { getFormat } from "@/i18n/server";
import { getSummaries } from "@/lib/evidence/investigations";
import { environmentOf, listProjects } from "@/lib/projects";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("projects"))("title") };
}

export default async function ProjectsPage() {
  const [projects, summaries, t, f] = await Promise.all([listProjects(), getSummaries(), getTranslations("projects"), getFormat()]);
  const unassigned = summaries.filter((s) => s.project === null).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Sheet
            variant="primary"
            trigger={
              <>
                <Plus /> {t("add")}
              </>
            }
            title={t("addTitle")}
          >
            <div className="flex flex-col gap-4 text-[13px] text-muted">
              <div className="flex items-center gap-2">
                <span className="text-fg">{t("addFromUi")}</span> <NotImplemented size="xs" />
              </div>
              <p>{t("noRegistry")}</p>
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>{t.rich("step1", { dir: () => <Mono>examples/&lt;name&gt;/</Mono>, file: () => <Mono>package.json</Mono> })}</li>
                <li>{t.rich("step2", { file: () => <Mono>benchmarks/&lt;suite&gt;/suite.json</Mono>, field: () => <Mono>app.cwd</Mono> })}</li>
                <li>
                  {t("step3")} <Mono>pnpm exegezis ai-verify --symptom &quot;…&quot; --base-url http://…</Mono>
                </li>
              </ol>
              <p>{t("noGithub")}</p>
            </div>
          </Sheet>
        }
      />
      {projects.length === 0 ? (
        <Panel title={t("none")}>
          <EmptyState icon={<FolderGit2 />} title={t("noneBody")} />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((p) => {
            const own = summaries.filter((s) => s.project === p.id);
            const envs = [...new Set(own.map((s) => environmentOf(s.target)).filter((e) => e !== null))];
            const last = own[0]?.createdAt ?? null;
            return (
              <Panel key={p.id} title={p.name} icon={<FolderGit2 />} subtitle={p.path}>
                {p.description !== null && (
                  <p className="mb-4 text-[13px] text-muted" translate="no">
                    {p.description}
                  </p>
                )}
                <Meta
                  items={[
                    { label: t("environments"), value: envs.length === 0 ? "—" : envs.join(", ") },
                    { label: t("browserRuntime"), value: "Playwright · Chromium" },
                    { label: t("investigations"), value: t("investigationsValue", { count: own.length, verified: own.filter((s) => s.outcome === "VERIFIED").length }) },
                    { label: t("lastActivity"), value: f.relative(last) },
                    {
                      label: t("repository"),
                      value: (
                        <span className="flex items-center gap-2">
                          {t("thisMonorepo")} <NotImplemented size="xs" />
                        </span>
                      ),
                    },
                  ]}
                />
                {p.suites.length > 0 && (
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="text-[11px] font-medium text-faint">{t("suites")}</div>
                    {p.suites.map((s) => (
                      <div key={s.id} className="rounded-md border border-line px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] text-fg">{s.id}</span>
                          <span className="rounded border border-line-strong px-1.5 py-px text-[11px] text-muted">{s.planSource === "human" ? t("humanPlans") : t("aiPlans")}</span>
                          <span className="text-xs text-faint">{t("cases", { count: s.cases })}</span>
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-faint">
                          {t("starts")} <span translate="no">{s.command}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4">
                  <Link href="/investigations" className="text-xs text-accent-text hover:underline">
                    {t("view")}
                  </Link>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
      {unassigned > 0 && <p className="text-xs text-faint">{t("unassigned", { count: unassigned })}</p>}
    </div>
  );
}
