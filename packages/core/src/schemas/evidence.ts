import { z } from "zod";
import { ErrorInfo, RelativePath, Timestamp, Viewport } from "./common.js";

/**
 * Evidence is what EXEGEZIS actually saw, recorded without interpretation.
 * Every record has a stable per-run `id` so that timeline events (and, later,
 * claims) can point at the exact piece of evidence that supports them.
 */

export const SourceLocation = z.strictObject({
  url: z.string(),
  line: z.int().nonnegative(),
  column: z.int().nonnegative(),
});
export type SourceLocation = z.infer<typeof SourceLocation>;

export const ConsoleLevel = z.enum(["log", "debug", "info", "warning", "error", "trace", "other"]);
export type ConsoleLevel = z.infer<typeof ConsoleLevel>;

export const ConsoleMessageEvidence = z.strictObject({
  kind: z.literal("console_message"),
  id: z.string(),
  timestamp: Timestamp,
  level: ConsoleLevel,
  /** Raw console API used (`log`, `warning`, `table`, ...). */
  apiType: z.string(),
  text: z.string(),
  location: SourceLocation.optional(),
  pageUrl: z.string().optional(),
});
export type ConsoleMessageEvidence = z.infer<typeof ConsoleMessageEvidence>;

/** An uncaught exception or unhandled rejection inside the target app. */
export const PageErrorEvidence = z.strictObject({
  kind: z.literal("page_error"),
  id: z.string(),
  timestamp: Timestamp,
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  location: SourceLocation.optional(),
  pageUrl: z.string().optional(),
});
export type PageErrorEvidence = z.infer<typeof PageErrorEvidence>;

/**
 * An error in EXEGEZIS' own execution (e.g. an action timed out). Kept
 * separate from page errors: one is a fact about the target, the other a fact
 * about our automation, and confusing the two would produce false bug reports.
 */
export const ExecutionErrorEvidence = z.strictObject({
  kind: z.literal("execution_error"),
  id: z.string(),
  timestamp: Timestamp,
  phase: z.enum(["start", "action", "assertion", "observe", "run", "collect", "close"]),
  actionId: z.string().optional(),
  error: ErrorInfo,
});
export type ExecutionErrorEvidence = z.infer<typeof ExecutionErrorEvidence>;

export const Headers = z.record(z.string(), z.string());

export const BodyCapture = z.discriminatedUnion("captured", [
  z.strictObject({
    captured: z.literal(true),
    mediaType: z.string(),
    sizeBytes: z.int().nonnegative(),
    truncated: z.boolean(),
    /** Body text after redaction. */
    text: z.string(),
  }),
  z.strictObject({
    captured: z.literal(false),
    reason: z.string(),
    sizeBytes: z.int().nonnegative().optional(),
  }),
]);
export type BodyCapture = z.infer<typeof BodyCapture>;

/**
 * One HTTP request and, when available, its response or failure. The
 * timeline records request, response and failure as separate events; this
 * record joins them so the exchange can be inspected as a unit.
 */
export const NetworkExchangeEvidence = z.strictObject({
  kind: z.literal("network_exchange"),
  id: z.string(),
  request: z.strictObject({
    timestamp: Timestamp,
    method: z.string(),
    url: z.string(),
    resourceType: z.string(),
    isNavigation: z.boolean(),
    /** A navigation of the page itself, not of an iframe (ads, widgets). Absent in older evidence: taken as the page's. */
    mainFrame: z.boolean().optional(),
    headers: Headers,
    body: BodyCapture.optional(),
  }),
  response: z
    .strictObject({
      timestamp: Timestamp,
      status: z.int(),
      statusText: z.string(),
      headers: Headers,
      fromServiceWorker: z.boolean(),
      body: BodyCapture.optional(),
    })
    .optional(),
  failure: z.strictObject({ timestamp: Timestamp, errorText: z.string() }).optional(),
  durationMs: z.number().nonnegative().optional(),
  /** Time to the first byte of the response, from the start of the request (ms). */
  ttfbMs: z.number().nonnegative().optional(),
  /** Bytes on the wire: the response body as sent (compressed if it was) and its headers. */
  sizes: z.strictObject({ body: z.int().nonnegative(), headers: z.int().nonnegative() }).optional(),
});
export type NetworkExchangeEvidence = z.infer<typeof NetworkExchangeEvidence>;

export const ScreenshotEvidence = z.strictObject({
  kind: z.literal("screenshot"),
  id: z.string(),
  timestamp: Timestamp,
  path: RelativePath,
  fullPage: z.boolean(),
  pageUrl: z.string(),
  reason: z.enum(["action", "observation", "failure"]),
  /** Timeline event that caused this screenshot. */
  triggerEventId: z.string().optional(),
});
export type ScreenshotEvidence = z.infer<typeof ScreenshotEvidence>;

/**
 * A node of the accessibility tree as produced by Playwright's
 * `ariaSnapshotJSON()`. Known fields are typed; additional state flags and
 * properties (e.g. `url` for links, `placeholder` for text boxes) are kept.
 */
export interface AccessibilityNode {
  role: string;
  name?: string | undefined;
  text?: string | undefined;
  children?: AccessibilityNode[] | undefined;
  [property: string]: unknown;
}
export const AccessibilityNode: z.ZodType<AccessibilityNode> = z.lazy(() =>
  z.looseObject({
    role: z.string(),
    name: z.string().optional(),
    text: z.string().optional(),
    children: z.array(AccessibilityNode).optional(),
  }),
);

export const AccessibilitySnapshotEvidence = z.strictObject({
  kind: z.literal("accessibility_snapshot"),
  id: z.string(),
  timestamp: Timestamp,
  pageUrl: z.string(),
  title: z.string(),
  format: z.literal("playwright-aria-json"),
  nodeCount: z.int().nonnegative(),
  tree: z.array(AccessibilityNode),
});
export type AccessibilitySnapshotEvidence = z.infer<typeof AccessibilitySnapshotEvidence>;

export const DomSnapshotEvidence = z.strictObject({
  kind: z.literal("dom_snapshot"),
  id: z.string(),
  timestamp: Timestamp,
  pageUrl: z.string(),
  path: RelativePath,
  sizeBytes: z.int().nonnegative(),
});
export type DomSnapshotEvidence = z.infer<typeof DomSnapshotEvidence>;

/** A full observation of the target's state at a point in time. */
export const Observation = z.strictObject({
  kind: z.literal("browser_page"),
  id: z.string(),
  timestamp: Timestamp,
  label: z.string().optional(),
  reason: z.enum(["plan", "failure"]),
  url: z.string(),
  title: z.string(),
  viewport: Viewport.nullable(),
  /** Whether the network went idle before the observation was taken. */
  settled: z.boolean(),
  evidence: z.strictObject({
    accessibility: z.string().optional(),
    dom: z.string().optional(),
    screenshot: z.string().optional(),
  }),
  /** Evidence that could not be captured for this observation, with the reason. */
  gaps: z.array(z.strictObject({ evidence: z.string(), reason: z.string() })),
});
export type Observation = z.infer<typeof Observation>;

export const Evidence = z.discriminatedUnion("kind", [
  ConsoleMessageEvidence,
  PageErrorEvidence,
  ExecutionErrorEvidence,
  NetworkExchangeEvidence,
  ScreenshotEvidence,
  AccessibilitySnapshotEvidence,
  DomSnapshotEvidence,
]);
export type Evidence = z.infer<typeof Evidence>;
export type EvidenceKind = Evidence["kind"];

/*
 * Evidence files. Each groups one kind of evidence for a run and carries its
 * own schema version so runs can be read back and validated later.
 */

export const ConsoleFile = z.strictObject({
  schemaVersion: z.literal("exegezis.console/v1"),
  messages: z.array(ConsoleMessageEvidence),
  pageErrors: z.array(PageErrorEvidence),
});
export type ConsoleFile = z.infer<typeof ConsoleFile>;

export const NetworkFile = z.strictObject({
  schemaVersion: z.literal("exegezis.network/v1"),
  exchanges: z.array(NetworkExchangeEvidence),
});
export type NetworkFile = z.infer<typeof NetworkFile>;

export const AccessibilityFile = z.strictObject({
  schemaVersion: z.literal("exegezis.accessibility/v1"),
  snapshots: z.array(AccessibilitySnapshotEvidence),
});
export type AccessibilityFile = z.infer<typeof AccessibilityFile>;

export const ObservationsFile = z.strictObject({
  schemaVersion: z.literal("exegezis.observations/v1"),
  observations: z.array(Observation),
  screenshots: z.array(ScreenshotEvidence),
  domSnapshots: z.array(DomSnapshotEvidence),
});
export type ObservationsFile = z.infer<typeof ObservationsFile>;

export function countAccessibilityNodes(nodes: readonly AccessibilityNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1 + countAccessibilityNodes(node.children ?? []);
  }
  return count;
}
