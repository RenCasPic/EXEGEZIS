import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RootCauseView } from "@/components/root-cause/root-cause-view";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { SourceTag } from "@/components/ui/status";
import { findRootCause, getSummaries } from "@/lib/evidence/investigations";

export const metadata: Metadata = { title: "Root cause" };

export default async function RootCausePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await findRootCause(id);
  if (entry === null) notFound();
  if (entry.report.status !== "ok") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={entry.ref.caseId} description="This report could not be loaded." />
        <p className="text-[13px] text-critical">{entry.report.status === "missing" ? "root-cause-report.json is missing." : entry.report.issues.join("; ")}</p>
      </div>
    );
  }
  const report = entry.report.value;
  const investigations = (await getSummaries()).filter((s) => (s.ref.caseId ?? s.planId) === report.bugId && s.outcome === "VERIFIED").slice(0, 5);
  return (
    <div className="flex flex-col gap-5">
      <Link href="/verification/root-causes" className="flex w-fit items-center gap-1 text-xs text-muted hover:text-fg">
        <ArrowLeft className="size-3" /> Root causes
      </Link>
      <PageHeader
        eyebrow={<SourceTag kind={entry.ref.archived ? "archived" : "real"} />}
        title={`${entry.ref.caseId} · root cause by intervention`}
        description={`Reproduction plan ${report.planId} (${report.planPath}). ${report.hypotheses.length} hypotheses, ${report.experiments.length} experiments.`}
      />
      <Panel title="Root cause">
        <RootCauseView entry={entry} report={report} />
      </Panel>
      {investigations.length > 0 && (
        <Panel title="Verified reproductions of this bug">
          <ul className="flex flex-col gap-1 text-[13px]">
            {investigations.map((s) => (
              <li key={s.ref.id}>
                <Link href={`/investigations/${s.ref.id}`} className="text-accent hover:underline">
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
