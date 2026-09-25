import { ArrowRight, TerminalSquare } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { ButtonLink, CodeBlock, Meta, Mono, PageHeader, Panel } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { getSummaries } from "@/lib/evidence/investigations";
import { absoluteTime, duration } from "@/lib/format";
import { commandFor, EXIT_MEANING, jobLog, jobOutputDir, readJob } from "@/lib/jobs";
import { displayPath } from "@/lib/workspace";

export const metadata: Metadata = { title: "Run" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await readJob(id);
  if (found === null) notFound();
  const { job, status } = found;
  const [log, summaries] = await Promise.all([jobLog(id), getSummaries()]);
  const investigation = summaries.find((s) => s.ref.jobId === id) ?? null;

  const tone = status === "running" ? "running" : status === "finished" ? (job.exitCode === 0 ? "positive" : "neutral") : "critical";
  const elapsed = (job.finishedAt === null ? Date.now() : Date.parse(job.finishedAt)) - Date.parse(job.startedAt);
  const command = ["pnpm exegezis", ...commandFor(job, displayPath(jobOutputDir(id))).map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a))].join(" ");

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh active={status === "running"} />
      <PageHeader
        eyebrow={<StatusPill status={status.toUpperCase()} tone={tone} />}
        title={job.symptom.split("\n")[0] ?? job.symptom}
        description={
          status === "running"
            ? "The CLI is running. This page follows its output and links the investigation as soon as its artifacts exist."
            : status === "lost"
              ? "The process is gone and never reported an exit code (the UI server was probably restarted). Its artifacts, if any, are kept."
              : undefined
        }
        actions={
          investigation !== null ? (
            <ButtonLink href={`/investigations/${investigation.ref.id}`} variant="primary">
              Open investigation <ArrowRight />
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Panel title="CLI output" icon={<TerminalSquare />} subtitle="output.log" bodyClassName="p-0">
          {log === null || log.trim() === "" ? (
            <div className="p-4 text-[13px] text-muted">No output yet.</div>
          ) : (
            <CodeBlock code={log} lineNumbers={false} className="rounded-none border-0" maxHeight="36rem" />
          )}
        </Panel>
        <Panel title="Run">
          <Meta
            items={[
              { label: "Job", value: <Mono>{job.id}</Mono> },
              { label: "Target", value: <Mono>{job.baseUrl}</Mono> },
              { label: "Planner", value: job.planner },
              { label: "Attempts", value: job.runs },
              { label: "Project", value: job.project ?? "Unassigned" },
              { label: "Started", value: absoluteTime(job.startedAt) },
              { label: "Elapsed", value: duration(elapsed) },
              {
                label: "Exit code",
                value: job.exitCode === null ? "—" : `${job.exitCode} (${EXIT_MEANING[job.exitCode] ?? "unknown"})`,
              },
              ...(job.error === null ? [] : [{ label: "Error", value: <span className="text-critical">{job.error}</span> }]),
            ]}
          />
          <div className="mt-4 text-xs text-faint">Same run from a terminal:</div>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-code p-2 font-mono text-[11px] text-muted">{command}</pre>
        </Panel>
      </div>
    </div>
  );
}
