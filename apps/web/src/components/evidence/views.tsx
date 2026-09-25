import type {
  AccessibilityFile,
  AccessibilityNode,
  ArtifactManifest,
  AssertionsFile,
  ConsoleFile,
  NetworkFile,
  ObservationsFile,
  Timeline,
  TimelineEvent,
} from "@exegezis/core";
import { describeAssertion } from "@exegezis/core";
import { Download, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { buttonClass, tableClass } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import type { Loaded } from "@/lib/evidence/read";
import { bytes, clockTime, compactJson, duration } from "@/lib/format";
import { artifactUrl } from "@/lib/urls";

/** Renders a loaded artifact, or says exactly why it cannot be shown. */
export function WithArtifact<T>({ loaded, name, children }: { loaded: Loaded<T>; name: string; children: (value: T) => ReactNode }) {
  if (loaded.status === "missing") return <p className="p-4 text-[13px] text-muted">{name} was not captured for this attempt.</p>;
  if (loaded.status === "invalid")
    return (
      <div className="p-4 text-[13px] text-critical">
        {name} exists but does not match its schema, so it is not shown:
        <ul className="mt-1 list-disc pl-5 font-mono text-[12px]">
          {loaded.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
    );
  return <>{children(loaded.value)}</>;
}

function eventSummary(e: TimelineEvent): string {
  switch (e.type) {
    case "RUN_STARTED":
      return `run ${e.payload.runId} → ${e.payload.targetUrl}`;
    case "RUN_FINISHED":
      return `${e.payload.status} after ${duration(e.payload.durationMs)}`;
    case "ADAPTER_STARTED":
      return `${e.payload.adapterId} ${Object.entries(e.payload.details).map(([k, v]) => `${k}=${String(v)}`).join(" ")}`;
    case "ADAPTER_STOPPED":
      return e.payload.adapterId;
    case "PLAN_STARTED":
      return `${e.payload.planId}: ${e.payload.title} (${e.payload.steps} steps)`;
    case "PLAN_FINISHED":
      return `${e.payload.verdict}${e.payload.stoppedAtStep === undefined ? "" : ` at step ${e.payload.stoppedAtStep}`}`;
    case "ACTION_STARTED":
      return `step ${e.payload.stepIndex ?? "?"}: ${e.payload.step.type}`;
    case "ACTION_SUCCEEDED":
      return `${e.payload.actionId} in ${duration(e.payload.durationMs)}`;
    case "ACTION_FAILED":
      return `${e.payload.actionId}: ${e.payload.error.message}`;
    case "ACTION_REJECTED":
      return `${e.payload.actionId}: ${e.payload.reason}`;
    case "ASSERTION_STARTED":
      return `step ${e.payload.stepIndex} [${e.payload.purpose}] ${describeAssertion(e.payload.assertion)}`;
    case "ASSERTION_PASSED":
      return `actual ${compactJson(e.payload.actual)}`;
    case "ASSERTION_FAILED":
      return e.payload.message;
    case "ASSERTION_TIMEOUT":
      return `${e.payload.timeoutReason}: ${e.payload.message}`;
    case "ASSERTION_ERROR":
      return `${e.payload.errorKind}: ${e.payload.message}`;
    case "PAGE_NAVIGATED":
    case "PAGE_LOADED":
    case "PAGE_CRASHED":
      return e.payload.url;
    case "CONSOLE_MESSAGE":
      return `[${e.payload.level}] ${e.payload.text}`;
    case "PAGE_ERROR":
      return `${e.payload.name}: ${e.payload.message}`;
    case "EXECUTION_ERROR":
      return `${e.payload.phase}: ${e.payload.message}`;
    case "NETWORK_REQUEST":
      return `${e.payload.method} ${e.payload.url}`;
    case "NETWORK_RESPONSE":
      return `${e.payload.status} ${e.payload.url}`;
    case "NETWORK_FAILED":
      return `${e.payload.url}: ${e.payload.errorText}`;
    case "OBSERVATION":
      return `${e.payload.observationId} ${e.payload.title} (${e.payload.settled ? "settled" : "not settled"})`;
    case "ACCESSIBILITY_SNAPSHOT":
      return `${e.payload.evidenceId}: ${e.payload.nodeCount} nodes`;
    case "DOM_SNAPSHOT":
    case "SCREENSHOT":
      return `${e.payload.evidenceId}: ${e.payload.path}`;
    case "TRACE_SAVED":
      return e.payload.path;
    case "COLLECTOR_FAILED":
      return `${e.payload.collector}: ${e.payload.error.message}`;
  }
}

function eventTone(type: TimelineEvent["type"]): string {
  if (type === "ASSERTION_FAILED" || type === "ACTION_FAILED" || type === "PAGE_ERROR" || type === "PAGE_CRASHED" || type === "NETWORK_FAILED") return "text-critical";
  if (type === "ASSERTION_TIMEOUT" || type === "ASSERTION_ERROR" || type === "EXECUTION_ERROR" || type === "COLLECTOR_FAILED") return "text-warning";
  if (type === "ASSERTION_PASSED") return "text-positive";
  if (type.startsWith("ASSERTION") || type.startsWith("ACTION")) return "text-fg";
  return "text-muted";
}

export function TimelineView({ timeline, highlight }: { timeline: Timeline; highlight: Set<string> }) {
  return (
    <ol className="divide-y divide-line font-mono text-[12px]">
      {timeline.events.map((e) => (
        <li key={e.id} id={e.id} className={cn("grid grid-cols-[88px_64px_68px_1fr] gap-3 px-4 py-1.5 hover:bg-hover/40", highlight.has(e.id) && "bg-accent/5")}>
          <span className="text-faint">{clockTime(e.timestamp)}</span>
          <span className="text-right text-faint">+{Math.round(e.elapsedMs)}ms</span>
          <span className="text-faint">{e.source}</span>
          <span className="min-w-0 break-words">
            <span className={cn("mr-2", eventTone(e.type))}>{e.type}</span>
            <span className="text-muted">{eventSummary(e)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const ASSERT_TONE = { passed: "positive", failed: "critical", timeout: "warning", error: "warning" } as const;

export function AssertionsView({ file }: { file: AssertionsFile }) {
  if (file.results.length === 0) return <p className="p-4 text-[13px] text-muted">No assertion was evaluated.</p>;
  return (
    <ul className="divide-y divide-line">
      {file.results.map((a) => (
        <li key={a.id} className="grid gap-2 px-4 py-3 md:grid-cols-[120px_1fr]">
          <div className="flex flex-col gap-1.5">
            <StatusPill status={a.status.toUpperCase()} tone={ASSERT_TONE[a.status]} size="xs" />
            <span className="font-mono text-[11px] text-faint">
              step {a.stepIndex} · {a.purpose}
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] text-fg">{a.description}</div>
            <div className="mt-0.5 font-mono text-[12px] text-muted">{describeAssertion(a.assertion)}</div>
            <div className="mt-1.5 grid gap-x-4 gap-y-0.5 font-mono text-[12px] sm:grid-cols-[auto_1fr]">
              <span className="text-faint">expected</span>
              <span className="break-all text-fg">{compactJson(a.expected)}</span>
              <span className="text-faint">observed</span>
              <span className={cn("break-all", a.status === "failed" ? "text-critical" : "text-fg")}>{compactJson(a.actual)}</span>
            </div>
            <div className="mt-1 text-xs text-faint">
              {a.message} · {a.attempts} evaluation(s) in {duration(a.durationMs)} (timeout {duration(a.timeoutMs)}) · {clockTime(a.finishedAt)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ConsoleView({ file }: { file: ConsoleFile }) {
  if (file.messages.length === 0 && file.pageErrors.length === 0) return <p className="p-4 text-[13px] text-muted">No console messages and no page errors were observed.</p>;
  return (
    <ol className="divide-y divide-line font-mono text-[12px]">
      {file.pageErrors.map((e) => (
        <li key={e.id} className="grid grid-cols-[88px_64px_1fr] gap-3 px-4 py-1.5 text-critical">
          <span className="text-faint">{clockTime(e.timestamp)}</span>
          <span>page error</span>
          <span className="break-words">
            {e.name}: {e.message}
          </span>
        </li>
      ))}
      {file.messages.map((m) => (
        <li key={m.id} className="grid grid-cols-[88px_64px_1fr] gap-3 px-4 py-1.5">
          <span className="text-faint">{clockTime(m.timestamp)}</span>
          <span className={m.level === "error" ? "text-critical" : m.level === "warning" ? "text-warning" : "text-muted"}>{m.level}</span>
          <span className="break-words text-fg">
            {m.text}
            {m.location !== undefined && (
              <span className="ml-2 text-faint">
                {m.location.url.replace(/^https?:\/\/[^/]+/, "")}:{m.location.line}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

export function NetworkView({ file, highlight }: { file: NetworkFile; highlight: Set<string> }) {
  if (file.exchanges.length === 0) return <p className="p-4 text-[13px] text-muted">No network exchanges were recorded.</p>;
  return (
    <ul className="divide-y divide-line">
      {file.exchanges.map((x) => {
        const status = x.response?.status;
        return (
          <li key={x.id}>
            <details className={cn("group", highlight.has(x.id) && "bg-accent/5")}>
              <summary className="grid cursor-pointer grid-cols-[88px_52px_44px_1fr_auto] items-center gap-3 px-4 py-1.5 font-mono text-[12px] hover:bg-hover/40">
                <span className="text-faint">{clockTime(x.request.timestamp)}</span>
                <span className="text-muted">{x.request.method}</span>
                <span className={status === undefined ? "text-critical" : status >= 400 ? "text-critical" : "text-positive"}>{status ?? "ERR"}</span>
                <span className="truncate text-fg" title={x.request.url}>
                  {pathOf(x.request.url)}
                </span>
                <span className="text-faint">
                  {x.request.resourceType} · {duration(x.durationMs)}
                </span>
              </summary>
              <div className="grid gap-3 border-t border-line bg-panel-2 px-4 py-3 md:grid-cols-2">
                {(["request", "response"] as const).map((side) => {
                  const part = side === "request" ? x.request : x.response;
                  if (part === undefined) return <div key={side} className="text-xs text-critical">{x.failure?.errorText ?? "No response"}</div>;
                  return (
                    <div key={side} className="min-w-0">
                      <div className="mb-1 text-[11px] uppercase tracking-wider text-faint">{side}</div>
                      <div className="max-h-40 overflow-auto rounded border border-line bg-code p-2 font-mono text-[11px]">
                        {Object.entries(part.headers).map(([k, v]) => (
                          <div key={k} className="break-all">
                            <span className="text-faint">{k}:</span> <span className="text-muted">{v}</span>
                          </div>
                        ))}
                      </div>
                      {part.body !== undefined &&
                        (part.body.captured ? (
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-line bg-code p-2 font-mono text-[11px] text-fg">
                            {part.body.text}
                            {part.body.truncated ? "\n… (truncated)" : ""}
                          </pre>
                        ) : (
                          <div className="mt-2 text-[11px] text-faint">body not captured: {part.body.reason}</div>
                        ))}
                    </div>
                  );
                })}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function ScreenshotView({ file, id, runPath }: { file: ObservationsFile; id: string; runPath: string }) {
  if (file.screenshots.length === 0) return <p className="p-4 text-[13px] text-muted">No screenshot was taken in this attempt.</p>;
  return (
    <div className="flex flex-col gap-4 p-4">
      {file.screenshots.map((s) => (
        <figure key={s.id} className="overflow-hidden rounded-md border border-line">
          {/* A local evidence file, served as-is: no image optimisation. */}
          <img src={artifactUrl(id, `${runPath}/${s.path}`)} alt={`Screenshot ${s.id} of ${s.pageUrl}`} className="w-full bg-white" />
          <figcaption className="flex flex-wrap gap-x-3 border-t border-line px-3 py-2 font-mono text-[11px] text-faint">
            <span>{s.id}</span>
            <span>{clockTime(s.timestamp)}</span>
            <span>reason: {s.reason}</span>
            <span>{s.pageUrl}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function DomView({ file, id, runPath }: { file: ObservationsFile; id: string; runPath: string }) {
  if (file.domSnapshots.length === 0) return <p className="p-4 text-[13px] text-muted">No DOM snapshot was captured in this attempt.</p>;
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs text-faint">Captured page content is untrusted: it is rendered in a sandboxed frame with scripts disabled.</p>
      {file.domSnapshots.map((d) => (
        <div key={d.id} className="overflow-hidden rounded-md border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 font-mono text-[11px] text-faint">
            <span>
              {d.id} · {clockTime(d.timestamp)} · {bytes(d.sizeBytes)}
            </span>
            <a href={artifactUrl(id, `${runPath}/${d.path}`, { source: true })} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline">
              View source <ExternalLink className="size-3" />
            </a>
          </div>
          <iframe title={`DOM snapshot ${d.id}`} sandbox="" src={artifactUrl(id, `${runPath}/${d.path}`)} className="h-[28rem] w-full bg-white" />
        </div>
      ))}
    </div>
  );
}

function renderTree(nodes: readonly AccessibilityNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${"  ".repeat(depth)}- ${n.role}${n.name === undefined ? "" : ` "${n.name}"`}${n.text === undefined ? "" : `: ${n.text}`}`,
    ...renderTree(n.children ?? [], depth + 1),
  ]);
}

export function AccessibilityView({ file }: { file: AccessibilityFile }) {
  if (file.snapshots.length === 0) return <p className="p-4 text-[13px] text-muted">No accessibility snapshot was captured.</p>;
  return (
    <div className="flex flex-col gap-4 p-4">
      {file.snapshots.map((s) => (
        <div key={s.id}>
          <div className="mb-1.5 font-mono text-[11px] text-faint">
            {s.id} · {clockTime(s.timestamp)} · {s.nodeCount} nodes · {s.pageUrl}
          </div>
          <pre className="max-h-[28rem] overflow-auto rounded-md border border-line bg-code p-3 font-mono text-[12px] leading-5 text-fg">{renderTree(s.tree).join("\n")}</pre>
        </div>
      ))}
    </div>
  );
}

export function TraceView({ manifest, id, runPath }: { manifest: ArtifactManifest; id: string; runPath: string }) {
  const trace = manifest.artifacts.find((a) => a.type === "trace");
  if (trace === undefined) {
    const missing = manifest.missing.find((m) => m.type === "trace");
    return <p className="p-4 text-[13px] text-muted">No trace in this attempt{missing === undefined ? "." : `: ${missing.reason}`}</p>;
  }
  const local = `${runPath}/${trace.path}`;
  return (
    <div className="flex flex-col gap-3 p-4 text-[13px]">
      <p className="text-muted">
        Full Playwright trace of the attempt ({bytes(trace.sizeBytes)}, sha256 <span className="font-mono">{trace.sha256.slice(0, 16)}…</span>). Open it with the Playwright trace
        viewer:
      </p>
      <pre className="overflow-x-auto rounded-md border border-line bg-code p-2 font-mono text-[12px] text-fg">npx playwright show-trace {`<investigation dir>/${local}`}</pre>
      <div>
        <a href={artifactUrl(id, local)} className={buttonClass("secondary", "sm")}>
          <Download /> Download trace.zip
        </a>
      </div>
    </div>
  );
}

const REDACTION_TONE = { verified: "positive", failed: "critical", not_scannable: "warning" } as const;

export function ManifestView({ manifest, id, runPath }: { manifest: ArtifactManifest; id: string; runPath: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="px-4 pt-3 text-xs text-muted">
        Manifest {manifest.complete ? "complete" : <span className="text-warning">incomplete</span>} · {manifest.artifacts.length} artifacts · every file hashed at capture time.
      </div>
      <div className={tableClass.wrap}>
        <table className={tableClass.table}>
          <thead>
            <tr>
              <th className={tableClass.th}>Type</th>
              <th className={tableClass.th}>File</th>
              <th className={tableClass.th}>Size</th>
              <th className={tableClass.th}>sha256</th>
              <th className={tableClass.th}>Redaction</th>
            </tr>
          </thead>
          <tbody>
            {manifest.artifacts.map((a) => (
              <tr key={a.path} className={tableClass.tr}>
                <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{a.type}</td>
                <td className={`${tableClass.td} font-mono text-[12px]`}>
                  <a href={artifactUrl(id, `${runPath}/${a.path}`, { source: a.path.endsWith(".html") })} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {a.path}
                  </a>
                </td>
                <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{bytes(a.sizeBytes)}</td>
                <td className={`${tableClass.td} font-mono text-[12px] text-faint`}>{a.sha256.slice(0, 12)}…</td>
                <td className={tableClass.td}>
                  <StatusPill status={a.redaction.replace("_", " ").toUpperCase()} tone={REDACTION_TONE[a.redaction]} size="xs" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manifest.missing.length > 0 && (
        <ul className="px-4 pb-3 text-xs text-warning">
          {manifest.missing.map((m) => (
            <li key={m.type}>
              missing {m.type}: {m.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
