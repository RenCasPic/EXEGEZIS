import type { Metadata } from "next";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { repositoryInfo } from "@/lib/git";
import { plannerCredentialsConfigured } from "@/lib/jobs";
import { listProjects } from "@/lib/projects";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "New investigation" };

/** Default target: the buggy-shop lab, the same default as `exegezis ai-verify`. */
const DEFAULT_BASE_URL = "http://localhost:3000/";

export default async function NewInvestigationPage() {
  const [projects, repo, credentials] = await Promise.all([listProjects(), repositoryInfo(), plannerCredentialsConfigured()]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="New investigation" description="Start from a symptom. EXEGEZIS plans a reproduction, executes it and records the evidence." />
      <Panel title="Symptom → Verified reproduction">
        <StartForm
          projects={projects.map((p) => p.id)}
          repository={repo.branch === null ? repo.name : `${repo.name} @ ${repo.branch}`}
          credentials={credentials}
          defaultBaseUrl={DEFAULT_BASE_URL}
        />
      </Panel>
    </div>
  );
}
