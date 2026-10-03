import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { DEFAULT_ANTHROPIC_MODEL, PLANNER_V1, redactText } from "@exegezis/planner";
import { Meta, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { NotImplemented, StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { getSummaries } from "@/lib/evidence/investigations";
import { repositoryInfo } from "@/lib/git";
import { plannerCredentialsConfigured } from "@/lib/jobs";
import { environmentOf } from "@/lib/projects";
import { isCloud } from "@/lib/cloud";
import { displayPath, repoRoot, runsDir } from "@/lib/workspace";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("title") };
}

const SECTIONS = ["general", "environment", "repository", "models", "security", "permissions"] as const;
/** In cloud mode the server's paths and repository are not the user's business. */
const CLOUD_HIDDEN: readonly string[] = ["repository"];
type Section = (typeof SECTIONS)[number];

/** A fixed, fake-only sample: shows what the planner's redaction does before anything leaves the machine. */
const REDACTION_SAMPLE = "Login fails for ana@example.com. Authorization: Bearer abcdefghijklmnop.qrstuvwx and password=hunter2hunter2";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const cloudMode = isCloud();
  const sections = SECTIONS.filter((s) => !cloudMode || !CLOUD_HIDDEN.includes(s));
  const section: Section = sections.includes(params.section as Section) ? (params.section as Section) : "general";
  const [repo, credentials, summaries, t] = await Promise.all([repositoryInfo(), plannerCredentialsConfigured(), getSummaries(), getTranslations("settings")]);
  const environments = [...new Set(summaries.map((s) => environmentOf(s.target)).filter((e) => e !== null))];
  const targets = [...new Set(summaries.map((s) => s.target).filter((t) => t !== null))].slice(0, 8);
  const redacted = redactText(REDACTION_SAMPLE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-5 md:grid-cols-[180px_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label={t("sectionsLabel")}>
          {cloudMode && (
            <Link href="/settings/account" className="rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover/60 hover:text-fg">
              {t("section.account")}
            </Link>
          )}
          {sections.map((s) => (
            <Link
              key={s}
              href={`/settings?section=${s}`}
              className={cn("rounded-md px-2.5 py-1.5 text-[13px]", s === section ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg")}
            >
              {t(`section.${s}`)}
            </Link>
          ))}
          <Link href="/settings/access" className="rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover/60 hover:text-fg">
            {t("section.access")}
          </Link>
          <Link href="/settings/search" className="rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-hover/60 hover:text-fg">
            {t("section.search")}
          </Link>
        </nav>

        {section === "general" && (
          <Panel title={t("section.general")}>
            <Meta
              items={
                cloudMode
                  ? [
                      { label: t("general.workspace"), value: t("general.cloudWorkspace") },
                      { label: t("general.dataSource"), value: t("general.dataSourceValue") },
                    ]
                  : [
                      { label: t("general.workspace"), value: t("general.workspaceValue") },
                      { label: t("general.repoRoot"), value: <Mono>{repoRoot()}</Mono> },
                      { label: t("general.runArtifacts"), value: <Mono>{displayPath(runsDir())}</Mono> },
                      { label: t("general.archived"), value: <Mono>benchmarks/*/results/</Mono> },
                      { label: t("general.dataSource"), value: t("general.dataSourceValue") },
                      { label: t("general.uiServer"), value: t("general.uiServerValue", { address: "127.0.0.1:4100" }) },
                    ]
              }
            />
          </Panel>
        )}

        {section === "environment" && (
          <Panel title={t("section.environment")}>
            <Meta
              items={[
                { label: t("environment.seen"), value: environments.length === 0 ? "—" : environments.join(", ") },
                { label: t("environment.defaultTarget"), value: <Mono>{t("environment.defaultTargetValue", { url: "http://localhost:3000/" })}</Mono> },
                {
                  label: t("environment.targets"),
                  value: (
                    <ul className="font-mono text-[12px]">
                      {targets.map((target) => (
                        <li key={target}>{target}</li>
                      ))}
                    </ul>
                  ),
                },
                { label: t("environment.named"), value: <NotImplemented size="xs" /> },
              ]}
            />
            <p className="mt-4 text-xs text-faint">{t("environment.note")}</p>
          </Panel>
        )}

        {section === "repository" && (
          <Panel title={t("section.repository")}>
            <Meta
              items={[
                { label: t("repository.repository"), value: <Mono>{repo.name}</Mono> },
                { label: t("repository.branch"), value: <Mono>{repo.branch ?? "—"}</Mono> },
                { label: t("repository.remote"), value: repo.remote === null ? "—" : <Mono>{repo.remote}</Mono> },
                { label: t("repository.github"), value: <NotImplemented size="xs" /> },
                { label: t("repository.analysis"), value: <NotImplemented size="xs" /> },
              ]}
            />
            <p className="mt-4 text-xs text-faint">{t("repository.note")}</p>
          </Panel>
        )}

        {section === "models" && (
          <Panel title={t("section.models")}>
            <Meta
              items={[
                { label: t("models.provider"), value: t("models.providerValue") },
                { label: t("models.defaultModel"), value: <Mono>{DEFAULT_ANTHROPIC_MODEL}</Mono> },
                { label: t("models.promptVersion"), value: <Mono>{PLANNER_V1.version}</Mono> },
                {
                  label: t("models.credentials"),
                  value: credentials ? (
                    <StatusPill status="CONFIGURED" tone="ok" size="xs" />
                  ) : (
                    <StatusPill status="MISSING" tone="warn" size="xs" />
                  ),
                },
                { label: t("models.calls"), value: t("models.callsValue") },
                { label: t("models.role"), value: t("models.roleValue") },
                { label: t("models.others"), value: <NotImplemented size="xs" /> },
              ]}
            />
            <p className="mt-4 text-xs text-faint">{t("models.note")}</p>
          </Panel>
        )}

        {section === "security" && (
          <Panel title={t("section.security")}>
            <div className="flex flex-col gap-4 text-[13px]">
              <Meta
                items={[
                  { label: t("security.beforeProvider"), value: t("security.beforeProviderValue") },
                  { label: t("security.evidence"), value: t("security.evidenceValue") },
                  { label: t("security.captured"), value: t("security.capturedValue") },
                  { label: t("security.artifactAccess"), value: t("security.artifactAccessValue") },
                  { label: t("security.network"), value: t("security.networkValue") },
                ]}
              />
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">{t("security.selfCheck")}</div>
                <pre className="whitespace-pre-wrap rounded-md border border-line bg-code p-2 font-mono text-[12px] text-muted" translate="no">{REDACTION_SAMPLE}</pre>
                <pre className="mt-1.5 whitespace-pre-wrap rounded-md border border-line bg-code p-2 font-mono text-[12px] text-fg" translate="no">{redacted.text}</pre>
                <div className="mt-1 font-mono text-[11px] text-faint">
                  {Object.entries(redacted.redactions)
                    .map(([k, v]) => `${k} ×${v}`)
                    .join(" · ")}
                </div>
              </div>
            </div>
          </Panel>
        )}

        {section === "permissions" && (
          <Panel title={t("section.permissions")} actions={<NotImplemented size="xs" />}>
            <p className="text-[13px] text-muted">
              {t("permissions.body")}
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
