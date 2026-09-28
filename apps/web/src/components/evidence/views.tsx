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
import { assertionMessage } from "@exegezis/core";
import { Download, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { buttonClass, tableClass } from "@/components/ui/primitives";
import { EngineText } from "@/components/ui/engine-text";
import { StatusPill } from "@/components/ui/status";
import { useFormat } from "@/i18n/client";
import type { Format } from "@/i18n/format";
import { cn } from "@/lib/cn";
import type { Loaded } from "@/lib/evidence/read";
import { clockTime, compactJson } from "@/lib/format";
import { artifactUrl } from "@/lib/urls";

/*
 * The raw evidence of an attempt. What the browser and the page produced
 * (messages, URLs, headers, bodies, the accessibility tree, event types) is
 * shown as recorded and marked translate="no"; only the surrounding words are
 * in the reader's language.
 */

type EvidenceT = ReturnType<typeof useTranslations<"evidence">>;

/** Renders a loaded artifact, or says exactly why it cannot be shown. */
export function WithArtifact<T>({ loaded, name, children }: { loaded: Loaded<T>; name: string; children: (value: T) => ReactNode }) {
  const t = useTranslations("evidence");
  if (loaded.status === "missing") return <p className="p-4 text-[13px] text-muted">{t("notCaptured", { name })}</p>;
  if (loaded.status === "invalid")
    return (
      <div className="p-4 text-[13px] text-bad">
        {t("invalid", { name })}
        <ul className="mt-1 list-disc pl-5 font-mono text-[12px]" translate="no">
          {loaded.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
    );
  return <>{children(loaded.value)}</>;
}

/** One line per event: its own words where it has fixed ones, its recorded data as is. */
function eventSummary(t: EvidenceT, f: Format, e: TimelineEvent): ReactNode {
  switch (e.type) {
    case "RUN_STARTED":
      return t("event.runStarted", { run: e.payload.runId, url: e.payload.targetUrl });
    case "RUN_FINISHED":
      return t("event.runFinished", { status: e.payload.status, duration: f.duration(e.payload.durationMs) });
    case "ADAPTER_STARTED":
      return `${e.payload.adapterId} ${Object.entries(e.payload.details)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ")}`;
    case "ADAPTER_STOPPED":
      return e.payload.adapterId;
    case "PLAN_STARTED":
      return t("event.planStarted", { plan: e.payload.planId, title: e.payload.title, steps: e.payload.steps });
    case "PLAN_FINISHED":
      return e.payload.stoppedAtStep === undefined ? t("event.planFinished", { verdict: e.payload.verdict }) : t("event.planFinishedAt", { verdict: e.payload.verdict, step: e.payload.stoppedAtStep });
    case "ACTION_STARTED":
      return t("event.actionStarted", { step: e.payload.stepIndex ?? "?", type: e.payload.step.type });
    case "ACTION_SUCCEEDED":
      return t("event.actionSucceeded", { action: e.payload.actionId, duration: f.duration(e.payload.durationMs) });
    case "ACTION_FAILED":
      return `${e.payload.actionId}: ${e.payload.error.message}`;
    case "ACTION_REJECTED":
      return `${e.payload.actionId}: ${e.payload.reason}`;
    case "ASSERTION_STARTED":
      return (
        <>
          {t("event.assertionStarted", { step: e.payload.stepIndex, purpose: e.payload.purpose })} <EngineText message={assertionMessage(e.payload.assertion)} text={null} />
        </>
      );
    case "ASSERTION_PASSED":
      return t("event.assertionPassed", { value: compactJson(e.payload.actual) });
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
      return t("event.observation", { id: e.payload.observationId, title: e.payload.title, settled: e.payload.settled ? "yes" : "no" });
    case "ACCESSIBILITY_SNAPSHOT":
      return t("event.accessibility", { id: e.payload.evidenceId, count: e.payload.nodeCount });
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
  if (type === "ASSERTION_FAILED" || type === "ACTION_FAILED" || type === "PAGE_ERROR" || type === "PAGE_CRASHED" || type === "NETWORK_FAILED") return "text-bad";
  if (type === "ASSERTION_TIMEOUT" || type === "ASSERTION_ERROR" || type === "EXECUTION_ERROR" || type === "COLLECTOR_FAILED") return "text-warn";
  if (type === "ASSERTION_PASSED") return "text-ok";
  if (type.startsWith("ASSERTION") || type.startsWith("ACTION")) return "text-fg";
  return "text-muted";
}

export function TimelineView({ timeline, highlight }: { timeline: Timeline; highlight: Set<string> }) {
  const t = useTranslations("evidence");
  const f = useFormat();
  return (
    <ol className="divide-y divide-line font-mono text-[12px]">
      {timeline.events.map((e) => (
        <li key={e.id} id={e.id} className={cn("grid grid-cols-[88px_64px_68px_1fr] gap-3 px-4 py-1.5 hover:bg-hover/40", highlight.has(e.id) && "bg-hover")}>
          <span className="text-faint">{clockTime(e.timestamp)}</span>
          <span className="text-right text-faint">+{Math.round(e.elapsedMs)}ms</span>
          <span className="text-faint" translate="no">
            {e.source}
          </span>
          <span className="min-w-0 break-words">
            <span className={cn("mr-2", eventTone(e.type))} translate="no">
              {e.type}
            </span>
            <span className="text-muted">{eventSummary(t, f, e)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

const ASSERT_TONE = { passed: "ok", failed: "bad", timeout: "warn", error: "warn" } as const;

export function AssertionsView({ file }: { file: AssertionsFile }) {
  const t = useTranslations("evidence.assertions");
  const f = useFormat();
  if (file.results.length === 0) return <p className="p-4 text-[13px] text-muted">{t("none")}</p>;
  return (
    <ul className="divide-y divide-line">
      {file.results.map((a) => (
        <li key={a.id} className="grid gap-2 px-4 py-3 md:grid-cols-[120px_1fr]">
          <div className="flex flex-col gap-1.5">
            <StatusPill status={a.status.toUpperCase()} tone={ASSERT_TONE[a.status]} size="xs" />
            <span className="font-mono text-[11px] text-faint">{t("stepPurpose", { step: a.stepIndex, purpose: a.purpose })}</span>
          </div>
          <div className="min-w-0">
            <div className="text-[13px] text-fg" translate="no">
              {a.description}
            </div>
            <div className="mt-0.5 font-mono text-[12px] text-muted">
              <EngineText message={assertionMessage(a.assertion)} text={null} />
            </div>
            <div className="mt-1.5 grid gap-x-4 gap-y-0.5 font-mono text-[12px] sm:grid-cols-[auto_1fr]">
              <span className="text-faint">{t("expected")}</span>
              <span className="break-all text-fg" translate="no">
                {compactJson(a.expected)}
              </span>
              <span className="text-faint">{t("observed")}</span>
              <span className={cn("break-all", a.status === "failed" ? "text-bad" : "text-fg")} translate="no">
                {compactJson(a.actual)}
              </span>
            </div>
            <div className="mt-1 text-xs text-faint">
              <EngineText message={a.detail} text={a.message} /> ·{" "}
              {t("evaluations", { count: a.attempts, duration: f.duration(a.durationMs), timeout: f.duration(a.timeoutMs), time: clockTime(a.finishedAt) })}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ConsoleView({ file }: { file: ConsoleFile }) {
  const t = useTranslations("evidence.console");
  if (file.messages.length === 0 && file.pageErrors.length === 0) return <p className="p-4 text-[13px] text-muted">{t("none")}</p>;
  return (
    <ol className="divide-y divide-line font-mono text-[12px]">
      {file.pageErrors.map((e) => (
        <li key={e.id} className="grid grid-cols-[88px_64px_1fr] gap-3 px-4 py-1.5 text-bad">
          <span className="text-faint">{clockTime(e.timestamp)}</span>
          <span>{t("pageError")}</span>
          <span className="break-words" translate="no">
            {e.name}: {e.message}
          </span>
        </li>
      ))}
      {file.messages.map((m) => (
        <li key={m.id} className="grid grid-cols-[88px_64px_1fr] gap-3 px-4 py-1.5">
          <span className="text-faint">{clockTime(m.timestamp)}</span>
          <span className={m.level === "error" ? "text-bad" : m.level === "warning" ? "text-warn" : "text-muted"} translate="no">
            {m.level}
          </span>
          <span className="break-words text-fg" translate="no">
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
  const t = useTranslations("evidence.network");
  const f = useFormat();
  if (file.exchanges.length === 0) return <p className="p-4 text-[13px] text-muted">{t("none")}</p>;
  return (
    <ul className="divide-y divide-line">
      {file.exchanges.map((x) => {
        const status = x.response?.status;
        return (
          <li key={x.id}>
            <details className={cn("group", highlight.has(x.id) && "bg-hover")}>
              <summary className="grid cursor-pointer grid-cols-[88px_52px_44px_1fr_auto] items-center gap-3 px-4 py-1.5 font-mono text-[12px] hover:bg-hover/40">
                <span className="text-faint">{clockTime(x.request.timestamp)}</span>
                <span className="text-muted">{x.request.method}</span>
                <span className={status === undefined ? "text-bad" : status >= 400 ? "text-bad" : "text-ok"}>{status ?? "ERR"}</span>
                <span className="truncate text-fg" title={x.request.url}>
                  {pathOf(x.request.url)}
                </span>
                <span className="text-faint">
                  {x.request.resourceType} · {f.duration(x.durationMs)}
                </span>
              </summary>
              <div className="grid gap-3 border-t border-line bg-panel-2 px-4 py-3 md:grid-cols-2">
                {(["request", "response"] as const).map((side) => {
                  const part = side === "request" ? x.request : x.response;
                  if (part === undefined)
                    return (
                      <div key={side} className="text-xs text-bad" translate="no">
                        {x.failure?.errorText ?? t("noResponse")}
                      </div>
                    );
                  return (
                    <div key={side} className="min-w-0">
                      <div className="mb-1 text-[11px] text-faint">{t(side)}</div>
                      <div className="max-h-40 overflow-auto rounded border border-line bg-code p-2 font-mono text-[11px]" translate="no">
                        {Object.entries(part.headers).map(([k, v]) => (
                          <div key={k} className="break-all">
                            <span className="text-faint">{k}:</span> <span className="text-muted">{v}</span>
                          </div>
                        ))}
                      </div>
                      {part.body !== undefined &&
                        (part.body.captured ? (
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-line bg-code p-2 font-mono text-[11px] text-fg" translate="no">
                            {part.body.text}
                            {part.body.truncated ? `\n${t("truncated")}` : ""}
                          </pre>
                        ) : (
                          <div className="mt-2 text-[11px] text-faint">{t("notCaptured", { reason: part.body.reason })}</div>
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
  const t = useTranslations("evidence.screenshots");
  if (file.screenshots.length === 0) return <p className="p-4 text-[13px] text-muted">{t("none")}</p>;
  return (
    <div className="flex flex-col gap-4 p-4">
      {file.screenshots.map((s) => (
        <figure key={s.id} className="overflow-hidden rounded-md border border-line">
          {/* A local evidence file, served as-is: no image optimisation. */}
          <img src={artifactUrl(id, `${runPath}/${s.path}`)} alt={t("alt", { id: s.id, url: s.pageUrl })} className="w-full bg-white" />
          <figcaption className="flex flex-wrap gap-x-3 border-t border-line px-3 py-2 font-mono text-[11px] text-faint">
            <span>{s.id}</span>
            <span>{clockTime(s.timestamp)}</span>
            <span>{t("reason", { reason: s.reason })}</span>
            <span>{s.pageUrl}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function DomView({ file, id, runPath }: { file: ObservationsFile; id: string; runPath: string }) {
  const t = useTranslations("evidence.dom");
  const f = useFormat();
  if (file.domSnapshots.length === 0) return <p className="p-4 text-[13px] text-muted">{t("none")}</p>;
  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs text-faint">{t("untrusted")}</p>
      {file.domSnapshots.map((d) => (
        <div key={d.id} className="overflow-hidden rounded-md border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 font-mono text-[11px] text-faint">
            <span>
              {d.id} · {clockTime(d.timestamp)} · {f.bytes(d.sizeBytes)}
            </span>
            <a href={artifactUrl(id, `${runPath}/${d.path}`, { source: true })} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent-text hover:underline">
              {t("source")} <ExternalLink className="size-3" />
            </a>
          </div>
          <iframe title={t("title", { id: d.id })} sandbox="" src={artifactUrl(id, `${runPath}/${d.path}`)} className="h-[28rem] w-full bg-white" />
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
  const t = useTranslations("evidence.a11y");
  if (file.snapshots.length === 0) return <p className="p-4 text-[13px] text-muted">{t("none")}</p>;
  return (
    <div className="flex flex-col gap-4 p-4">
      {file.snapshots.map((s) => (
        <div key={s.id}>
          <div className="mb-1.5 font-mono text-[11px] text-faint">
            {s.id} · {clockTime(s.timestamp)} · {t("nodes", { count: s.nodeCount })} · {s.pageUrl}
          </div>
          <pre className="max-h-[28rem] overflow-auto rounded-md border border-line bg-code p-3 font-mono text-[12px] leading-5 text-fg" translate="no">
            {renderTree(s.tree).join("\n")}
          </pre>
        </div>
      ))}
    </div>
  );
}

export function TraceView({ manifest, id, runPath }: { manifest: ArtifactManifest; id: string; runPath: string }) {
  const t = useTranslations("evidence.trace");
  const f = useFormat();
  const trace = manifest.artifacts.find((a) => a.type === "trace");
  if (trace === undefined) {
    const missing = manifest.missing.find((m) => m.type === "trace");
    return <p className="p-4 text-[13px] text-muted">{missing === undefined ? t("none") : t("noneReason", { reason: missing.reason })}</p>;
  }
  const local = `${runPath}/${trace.path}`;
  return (
    <div className="flex flex-col gap-3 p-4 text-[13px]">
      <p className="text-muted">{t.rich("full", { size: f.bytes(trace.sizeBytes), hash: () => <span className="font-mono">{trace.sha256.slice(0, 16)}…</span> })}</p>
      <pre className="overflow-x-auto rounded-md border border-line bg-code p-2 font-mono text-[12px] text-fg">
        npx playwright show-trace {`${t("dir")}/${local}`}
      </pre>
      <div>
        <a href={artifactUrl(id, local)} className={buttonClass("secondary", "sm")}>
          <Download /> {t("download")}
        </a>
      </div>
    </div>
  );
}

const REDACTION_TONE = { verified: "ok", failed: "bad", not_scannable: "warn" } as const;

export function ManifestView({ manifest, id, runPath }: { manifest: ArtifactManifest; id: string; runPath: string }) {
  const t = useTranslations("evidence.manifest");
  const f = useFormat();
  return (
    <div className="flex flex-col gap-3">
      <div className={cn("px-4 pt-3 text-xs", manifest.complete ? "text-muted" : "text-warn")}>{t("summary", { complete: manifest.complete ? "yes" : "no", count: manifest.artifacts.length })}</div>
      <div className={tableClass.wrap}>
        <table className={tableClass.table}>
          <thead>
            <tr>
              <th className={tableClass.th}>{t("type")}</th>
              <th className={tableClass.th}>{t("file")}</th>
              <th className={tableClass.th}>{t("size")}</th>
              <th className={tableClass.th} translate="no">
                sha256
              </th>
              <th className={tableClass.th}>{t("redaction")}</th>
            </tr>
          </thead>
          <tbody>
            {manifest.artifacts.map((a) => (
              <tr key={a.path} className={tableClass.tr}>
                <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{a.type}</td>
                <td className={`${tableClass.td} font-mono text-[12px]`}>
                  <a href={artifactUrl(id, `${runPath}/${a.path}`, { source: a.path.endsWith(".html") })} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                    {a.path}
                  </a>
                </td>
                <td className={`${tableClass.td} font-mono text-[12px] text-muted`}>{f.bytes(a.sizeBytes)}</td>
                <td className={`${tableClass.td} font-mono text-[12px] text-faint`}>{a.sha256.slice(0, 12)}…</td>
                <td className={tableClass.td}>
                  <StatusPill status={a.redaction.toUpperCase()} tone={REDACTION_TONE[a.redaction]} size="xs" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {manifest.missing.length > 0 && (
        <ul className="px-4 pb-3 text-xs text-warn">
          {manifest.missing.map((m) => (
            <li key={m.type}>{t("missing", { type: m.type, reason: m.reason })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
