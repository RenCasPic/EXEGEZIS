import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { plannerCredentialsConfigured } from "@/lib/jobs";
import { listProjects } from "@/lib/projects";
import { StartForm } from "./start-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("investigations.new"))("title") };
}

/** Default target: the buggy-shop lab, the same default as `exegezis ai-verify`. */
const DEFAULT_BASE_URL = "http://localhost:3000/";

export default async function NewInvestigationPage() {
  const [projects, credentials, t] = await Promise.all([listProjects(), plannerCredentialsConfigured(), getTranslations("investigations.new")]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <Panel title={t("panel")}>
        <StartForm
          projects={projects.map((p) => p.id)}
          credentials={credentials}
          defaultBaseUrl={DEFAULT_BASE_URL}
        />
      </Panel>
    </div>
  );
}
