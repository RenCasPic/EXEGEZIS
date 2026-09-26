import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_ANTHROPIC_MODEL, PLANNER_V1, redactText } from "@exegezis/planner";
import { Meta, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { NotImplemented, StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { getSummaries } from "@/lib/evidence/investigations";
import { repositoryInfo } from "@/lib/git";
import { plannerCredentialsConfigured } from "@/lib/jobs";
import { environmentOf } from "@/lib/projects";
import { displayPath, repoRoot, runsDir } from "@/lib/workspace";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = ["general", "environment", "repository", "models", "security", "permissions"] as const;
type Section = (typeof SECTIONS)[number];

/** A fixed, fake-only sample: shows what the planner's redaction does before anything leaves the machine. */
const REDACTION_SAMPLE = "Login fails for ana@example.com. Authorization: Bearer abcdefghijklmnop.qrstuvwx and password=hunter2hunter2";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const section: Section = SECTIONS.includes(params.section as Section) ? (params.section as Section) : "general";
  const [repo, credentials, summaries] = await Promise.all([repositoryInfo(), plannerCredentialsConfigured(), getSummaries()]);
  const environments = [...new Set(summaries.map((s) => environmentOf(s.target)).filter((e) => e !== null))];
  const targets = [...new Set(summaries.map((s) => s.target).filter((t) => t !== null))].slice(0, 8);
  const redacted = redactText(REDACTION_SAMPLE);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Settings" description="Read-only view of the local configuration EXEGEZIS actually uses. Nothing here is editable yet." />
      <div className="grid gap-5 md:grid-cols-[180px_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <Link
              key={s}
              href={`/settings?section=${s}`}
              className={cn("rounded-md px-2.5 py-1.5 text-[13px] capitalize", s === section ? "bg-hover text-fg" : "text-muted hover:bg-hover/60 hover:text-fg")}
            >
              {s}
            </Link>
          ))}
        </nav>

        {section === "general" && (
          <Panel title="General">
            <Meta
              items={[
                { label: "Workspace", value: "Local workspace (single user, this machine)" },
                { label: "Repository root", value: <Mono>{repoRoot()}</Mono> },
                { label: "Run artifacts", value: <Mono>{displayPath(runsDir())}</Mono> },
                { label: "Archived results", value: <Mono>benchmarks/*/results/</Mono> },
                { label: "Data source", value: "Artifacts on disk only. No database, no demo data." },
                { label: "UI server", value: <Mono>127.0.0.1:4100 (local only)</Mono> },
              ]}
            />
          </Panel>
        )}

        {section === "environment" && (
          <Panel title="Environment">
            <Meta
              items={[
                { label: "Environments seen", value: environments.length === 0 ? "—" : environments.join(", ") },
                { label: "Default AI target", value: <Mono>http://localhost:3000/ (buggy-shop)</Mono> },
                {
                  label: "Targets on record",
                  value: (
                    <ul className="font-mono text-[12px]">
                      {targets.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  ),
                },
                { label: "Named environments", value: <NotImplemented size="xs" /> },
              ]}
            />
            <p className="mt-4 text-xs text-faint">Environments are derived from each run&apos;s target URL; loopback addresses are reported as Local.</p>
          </Panel>
        )}

        {section === "repository" && (
          <Panel title="Repository">
            <Meta
              items={[
                { label: "Repository", value: <Mono>{repo.name}</Mono> },
                { label: "Branch", value: <Mono>{repo.branch ?? "—"}</Mono> },
                { label: "Remote", value: repo.remote === null ? "—" : <Mono>{repo.remote}</Mono> },
                { label: "GitHub connection", value: <NotImplemented size="xs" /> },
                { label: "Code analysis", value: <NotImplemented size="xs" /> },
              ]}
            />
            <p className="mt-4 text-xs text-faint">Read from the local .git directory. No stage reads or analyses source code yet.</p>
          </Panel>
        )}

        {section === "models" && (
          <Panel title="Models">
            <Meta
              items={[
                { label: "Planner provider", value: "Anthropic (Messages API, structured output)" },
                { label: "Default model", value: <Mono>{DEFAULT_ANTHROPIC_MODEL}</Mono> },
                { label: "Prompt version", value: <Mono>{PLANNER_V1.version}</Mono> },
                {
                  label: "Credentials",
                  value: credentials ? (
                    <StatusPill status="CONFIGURED" tone="ok" size="xs" />
                  ) : (
                    <StatusPill status="MISSING" tone="warn" size="xs" />
                  ),
                },
                { label: "Calls per plan", value: "Exactly one. No retries, no repair, no agent loop." },
                { label: "Role", value: "Writes a TestPlan. Never decides a verdict; its confidence is never evidence." },
                { label: "Other providers", value: <NotImplemented size="xs" /> },
              ]}
            />
            <p className="mt-4 text-xs text-faint">Credentials are checked for presence only. Their value is never read into the UI.</p>
          </Panel>
        )}

        {section === "security" && (
          <Panel title="Security">
            <div className="flex flex-col gap-4 text-[13px]">
              <Meta
                items={[
                  { label: "Before the provider", value: "Symptom and page structure are redacted for secrets and personal data." },
                  { label: "Evidence", value: "Run artifacts are redacted and hashed at capture; the manifest records the redaction status of each file." },
                  { label: "Captured pages", value: "Rendered only in a sandboxed frame with scripts disabled (CSP sandbox)." },
                  { label: "Artifact access", value: "Only files inside discovered run directories, read-only." },
                  { label: "Network", value: "The UI listens on 127.0.0.1 only." },
                ]}
              />
              <div>
                <div className="mb-1.5 text-[11px] font-medium text-faint">Redaction self-check (live, fake sample)</div>
                <pre className="whitespace-pre-wrap rounded-md border border-line bg-code p-2 font-mono text-[12px] text-muted">{REDACTION_SAMPLE}</pre>
                <pre className="mt-1.5 whitespace-pre-wrap rounded-md border border-line bg-code p-2 font-mono text-[12px] text-fg">{redacted.text}</pre>
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
          <Panel title="Permissions" actions={<NotImplemented size="xs" />}>
            <p className="text-[13px] text-muted">
              There are no accounts, roles or permissions: the UI runs locally for the user who started it. Authentication and access control are not implemented.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
