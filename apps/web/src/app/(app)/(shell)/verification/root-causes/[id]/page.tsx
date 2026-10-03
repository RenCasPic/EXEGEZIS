import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RootCauseView } from "@/components/root-cause/root-cause-view";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { SourceTag } from "@/components/ui/status";
import { findRootCause, getSummaries } from "@/lib/evidence/investigations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("rootCauses.detail"))("title") };
}

export default async function RootCausePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [entry, t] = await Promise.all([findRootCause(id), getTranslations("rootCauses.detail")]);
  if (entry === null) notFound();
  if (entry.report.status !== "ok") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={entry.ref.caseId} description={t("loadFailed")} />
        <p className="text-[13px] text-bad">{entry.report.status === "missing" ? t("missing") : <span translate="no">{entry.report.issues.join("; ")}</span>}</p>
      </div>
    );
  }
  const report = entry.report.value;
  const investigations = (await getSummaries()).filter((s) => (s.ref.caseId ?? s.planId) === report.bugId && s.outcome === "VERIFIED").slice(0, 5);
  return (
    <div className="flex flex-col gap-5">
      <Link href="/verification/root-causes" className="flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <ArrowLeft className="size-3" /> {t("back")}
      </Link>
      <PageHeader
        eyebrow={<SourceTag kind={entry.ref.archived ? "archived" : "real"} />}
        title={t("heading", { case: entry.ref.caseId })}
        description={t("description", { plan: report.planId, path: report.planPath, hypotheses: report.hypotheses.length, experiments: report.experiments.length })}
      />
      <Panel title={t("title")}>
        <RootCauseView entry={entry} report={report} />
      </Panel>
      {investigations.length > 0 && (
        <Panel title={t("reproductions")}>
          <ul className="flex flex-col gap-1 text-[13px]">
            {investigations.map((s) => (
              <li key={s.ref.id}>
                <Link href={`/investigations/${s.ref.id}`} className="text-accent-text hover:underline" translate="no">
                  {s.title}
                </Link>{" "}
                <span className="font-mono text-[11px] text-faint">{s.ref.id}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
