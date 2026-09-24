import { z } from "zod";
import { PlanStep } from "./action.js";
import { ErrorInfo, RelativePath, RunId, Timestamp } from "./common.js";
import { ConsoleLevel } from "./evidence.js";

/**
 * Who produced an event. `runner` is EXEGEZIS itself; the rest are observed
 * sources inside the target.
 */
export const EventSource = z.enum(["runner", "adapter", "page", "console", "network"]);
export type EventSource = z.infer<typeof EventSource>;

const RunStatusFinal = z.enum(["completed", "failed"]);

/**
 * Payload schema for each timeline event type. Payloads are summaries; the
 * full record lives in the evidence file and is referenced by `evidenceId`.
 */
export const TimelinePayloads = {
  RUN_STARTED: z.strictObject({ runId: RunId, targetUrl: z.string() }),
  RUN_FINISHED: z.strictObject({
    status: RunStatusFinal,
    durationMs: z.number().nonnegative(),
    error: ErrorInfo.optional(),
  }),
  ADAPTER_STARTED: z.strictObject({
    adapterId: z.string(),
    details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  }),
  ADAPTER_STOPPED: z.strictObject({ adapterId: z.string() }),
  ACTION_STARTED: z.strictObject({ actionId: z.string(), step: PlanStep }),
  ACTION_SUCCEEDED: z.strictObject({ actionId: z.string(), durationMs: z.number().nonnegative() }),
  ACTION_FAILED: z.strictObject({
    actionId: z.string(),
    durationMs: z.number().nonnegative(),
    evidenceId: z.string(),
    error: ErrorInfo,
  }),
  ACTION_REJECTED: z.strictObject({ actionId: z.string(), reason: z.string() }),
  PAGE_NAVIGATED: z.strictObject({ url: z.string() }),
  PAGE_LOADED: z.strictObject({ url: z.string() }),
  PAGE_CRASHED: z.strictObject({ url: z.string() }),
  CONSOLE_MESSAGE: z.strictObject({ evidenceId: z.string(), level: ConsoleLevel, text: z.string() }),
  PAGE_ERROR: z.strictObject({ evidenceId: z.string(), name: z.string(), message: z.string() }),
  EXECUTION_ERROR: z.strictObject({ evidenceId: z.string(), phase: z.string(), message: z.string() }),
  NETWORK_REQUEST: z.strictObject({
    evidenceId: z.string(),
    method: z.string(),
    url: z.string(),
    resourceType: z.string(),
  }),
  NETWORK_RESPONSE: z.strictObject({
    evidenceId: z.string(),
    status: z.int(),
    url: z.string(),
  }),
  NETWORK_FAILED: z.strictObject({ evidenceId: z.string(), url: z.string(), errorText: z.string() }),
  OBSERVATION: z.strictObject({
    observationId: z.string(),
    url: z.string(),
    title: z.string(),
    settled: z.boolean(),
  }),
  ACCESSIBILITY_SNAPSHOT: z.strictObject({ evidenceId: z.string(), nodeCount: z.int().nonnegative() }),
  DOM_SNAPSHOT: z.strictObject({ evidenceId: z.string(), path: RelativePath }),
  SCREENSHOT: z.strictObject({ evidenceId: z.string(), path: RelativePath, reason: z.string() }),
  TRACE_SAVED: z.strictObject({ path: RelativePath }),
  COLLECTOR_FAILED: z.strictObject({ collector: z.string(), error: ErrorInfo }),
} as const;

export type TimelineEventType = keyof typeof TimelinePayloads;
export type TimelinePayload<T extends TimelineEventType> = z.infer<(typeof TimelinePayloads)[T]>;

const EventBase = {
  /** Per-run sequential id, e.g. `evt-000042`. */
  id: z.string(),
  /** Monotonic order of emission; authoritative when timestamps tie. */
  seq: z.int().positive(),
  timestamp: Timestamp,
  /** Milliseconds since the run started (monotonic clock). */
  elapsedMs: z.number().nonnegative(),
  source: EventSource,
};

function eventSchema<T extends TimelineEventType>(type: T) {
  return z.strictObject({ ...EventBase, type: z.literal(type), payload: TimelinePayloads[type] });
}

export const TimelineEvent = z.discriminatedUnion("type", [
  eventSchema("RUN_STARTED"),
  eventSchema("RUN_FINISHED"),
  eventSchema("ADAPTER_STARTED"),
  eventSchema("ADAPTER_STOPPED"),
  eventSchema("ACTION_STARTED"),
  eventSchema("ACTION_SUCCEEDED"),
  eventSchema("ACTION_FAILED"),
  eventSchema("ACTION_REJECTED"),
  eventSchema("PAGE_NAVIGATED"),
  eventSchema("PAGE_LOADED"),
  eventSchema("PAGE_CRASHED"),
  eventSchema("CONSOLE_MESSAGE"),
  eventSchema("PAGE_ERROR"),
  eventSchema("EXECUTION_ERROR"),
  eventSchema("NETWORK_REQUEST"),
  eventSchema("NETWORK_RESPONSE"),
  eventSchema("NETWORK_FAILED"),
  eventSchema("OBSERVATION"),
  eventSchema("ACCESSIBILITY_SNAPSHOT"),
  eventSchema("DOM_SNAPSHOT"),
  eventSchema("SCREENSHOT"),
  eventSchema("TRACE_SAVED"),
  eventSchema("COLLECTOR_FAILED"),
]);
export type TimelineEvent = z.infer<typeof TimelineEvent>;

export const Timeline = z.strictObject({
  schemaVersion: z.literal("exegezis.timeline/v1"),
  runId: RunId,
  events: z.array(TimelineEvent),
});
export type Timeline = z.infer<typeof Timeline>;
