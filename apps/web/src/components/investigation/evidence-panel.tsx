import { FileSearch } from "lucide-react";
import Link from "next/link";
import type { BugReport } from "@exegezis/core";
import {
  AccessibilityView,
  AssertionsView,
  ConsoleView,
  DomView,
  ManifestView,
  NetworkView,
  ScreenshotView,
  TimelineView,
  TraceView,
  WithArtifact,
} from "@/components/evidence/views";
import { Panel, TabLinks } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import type { AttemptEvidence } from "@/lib/evidence/attempt";
import type { AttemptEntry, InvestigationSummary } from "@/lib/evidence/investigations";

export const EVIDENCE_TABS = ["timeline", "assertions", "console", "network", "dom", "screenshot", "accessibility", "trace", "manifest"] as const;
export type EvidenceTab = (typeof EVIDENCE_TABS)[number];

const TAB_LABEL: Record<EvidenceTab, string> = {
  timeline: "Timeline",
  assertions: "Assertions",
  console: "Console",
  network: "Network",
  dom: "DOM",
  screenshot: "Screenshot",
  accessibility: "Accessibility",
  trace: "Trace",
  manifest: "Manifest",
};

/** Evidence ids the BugReport cites (event ranges are expanded against the timeline). */
function citedIds(report: BugReport | null, evidence: AttemptEvidence): Set<string> {
  const ids = new Set<string>();
  if (report === null) return ids;
  const events = evidence.timeline.status === "ok" ? evidence.timeline.value.events.map((e) => e.id) : [];
  for (const ref of report.evidence) {
    if (ref.ref === undefined || !ref.path.startsWith(`${evidence.runPath}/`)) continue;
    const range = /^(evt-\d+)\.\.(evt-\d+)$/.exec(ref.ref);
    if (range !== null) {
      const from = events.indexOf(range[1] ?? "");
      const to = events.indexOf(range[2] ?? "");
      if (from >= 0 && to >= from) for (const id of events.slice(from, to + 1)) ids.add(id);
    } else {
      ids.add(ref.ref);
    }
  }
  return ids;
}

export function EvidencePanel({
  summary,
  report,
  attempts,
  evidence,
  tab,
  investigationId,
}: {
  summary: InvestigationSummary;
  report: BugReport | null;
  attempts: AttemptEntry[];
  evidence: AttemptEvidence | null;
  tab: EvidenceTab;
  investigationId: string;
}) {
  const stage = summary.stages.find((s) => s.id === "evidence");
  const base = `/investigations/${investigationId}`;
  const query = (patch: { attempt?: string; tab?: string }) => {
    const params = new URLSearchParams();
    const attempt = patch.attempt ?? evidence?.runPath.split("/").pop();
    if (attempt !== undefined) params.set("attempt", attempt);
    params.set("tab", patch.tab ?? tab);
    return `${base}?${params.toString()}#evidence`;
  };

  return (
    <Panel
      id="evidence"
      title="Evidence"
      icon={<FileSearch />}
      subtitle={evidence === null ? undefined : `attempt ${evidence.runPath.split("/").pop() ?? ""}`}
      actions={
        <>
          <span className="rounded border border-line-strong px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-muted">Observed</span>
          {stage !== undefined && <StatusPill status={stage.status} tone={stage.tone} size="xs" />}
        </>
      }
      bodyClassName="p-0"
    >
      {evidence === null ? (
        <p className="p-4 text-[13px] text-muted">{stage?.detail}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
            <span className="mr-1 text-xs text-faint">Attempt</span>
            {attempts
              .filter((a) => a.onDisk)
              .map((a) => {
                const selected = evidence.runPath === a.runPath;
                return (
                  <Link
                    key={a.runId}
                    href={query({ attempt: a.runId })}
                    scroll={false}
                    title={`${a.runId} · ${a.verdict}`}
                    className={cn(
                      "flex h-6 min-w-6 items-center justify-center rounded border px-1.5 font-mono text-[11px]",
                      selected ? "border-accent text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg",
                      a.verdict === "failed" ? "" : "opacity-80",
                    )}
                  >
                    {a.attempt}
                    <span className={cn("ml-1 size-1.5 rounded-full", a.verdict === "failed" ? "bg-critical" : a.verdict === "passed" ? "bg-neutral" : "bg-warning")} />
                  </Link>
                );
              })}
          </div>
          <TabLinks active={tab} tabs={EVIDENCE_TABS.map((t) => ({ id: t, label: TAB_LABEL[t], href: query({ tab: t }) }))} />
          <div className="max-h-[40rem] overflow-y-auto">
            <EvidenceTabBody tab={tab} evidence={evidence} investigationId={investigationId} highlight={citedIds(report, evidence)} />
          </div>
          <div className="border-t border-line px-4 py-2 text-[11px] text-faint">
            Everything above was recorded by the browser adapter during this attempt. Highlighted rows are cited by the BugReport. Nothing here is inferred.
          </div>
        </>
      )}
    </Panel>
  );
}

function EvidenceTabBody({ tab, evidence, investigationId, highlight }: { tab: EvidenceTab; evidence: AttemptEvidence; investigationId: string; highlight: Set<string> }) {
  const { runPath } = evidence;
  switch (tab) {
    case "timeline":
      return <WithArtifact loaded={evidence.timeline} name="timeline.json">{(t) => <TimelineView timeline={t} highlight={highlight} />}</WithArtifact>;
    case "assertions":
      return <WithArtifact loaded={evidence.assertions} name="assertions.json">{(a) => <AssertionsView file={a} />}</WithArtifact>;
    case "console":
      return <WithArtifact loaded={evidence.console} name="console.json">{(c) => <ConsoleView file={c} />}</WithArtifact>;
    case "network":
      return <WithArtifact loaded={evidence.network} name="network.json">{(n) => <NetworkView file={n} highlight={highlight} />}</WithArtifact>;
    case "dom":
      return <WithArtifact loaded={evidence.observations} name="observations.json">{(o) => <DomView file={o} id={investigationId} runPath={runPath} />}</WithArtifact>;
    case "screenshot":
      return <WithArtifact loaded={evidence.observations} name="observations.json">{(o) => <ScreenshotView file={o} id={investigationId} runPath={runPath} />}</WithArtifact>;
    case "accessibility":
      return <WithArtifact loaded={evidence.accessibility} name="accessibility.json">{(a) => <AccessibilityView file={a} />}</WithArtifact>;
    case "trace":
      return <WithArtifact loaded={evidence.manifest} name="manifest.json">{(m) => <TraceView manifest={m} id={investigationId} runPath={runPath} />}</WithArtifact>;
    case "manifest":
      return <WithArtifact loaded={evidence.manifest} name="manifest.json">{(m) => <ManifestView manifest={m} id={investigationId} runPath={runPath} />}</WithArtifact>;
  }
}
