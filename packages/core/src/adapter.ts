import { z } from "zod";
import type { Logger } from "./logger.js";
import type { RunRecorder } from "./recorder.js";
import { ActionType, type Action } from "./schemas/action.js";
import { AssertionKind, type Assertion, type AssertionEvaluation } from "./schemas/assertion.js";
import type { Observation } from "./schemas/evidence.js";
import { ArtifactType } from "./schemas/manifest.js";
import type { CollectorStatus, RunEnvironment } from "./schemas/run.js";

/**
 * What an adapter can do. Capabilities are declared, not implied by the
 * interface: a CLI adapter would declare `process`/`logs`, never `dom`.
 * Only capabilities that some adapter really implements are listed here.
 */
export const Capability = z.enum([
  "browser",
  "dom",
  "accessibility",
  "network",
  "console",
  "page_errors",
  "screenshots",
  "trace",
]);
export type Capability = z.infer<typeof Capability>;

/**
 * Structured answer to "what can this adapter do?". The runner uses it to
 * reject unsupported actions before they reach the adapter, and (later) the
 * agent layer will derive its tool list from it.
 */
export const AdapterDescriptor = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.string(),
  description: z.string(),
  capabilities: z.array(Capability),
  actions: z.array(ActionType),
  /** Assertion kinds this adapter can evaluate. */
  assertions: z.array(AssertionKind),
  /** Artifact types this adapter produces on a successful run. */
  produces: z.array(ArtifactType),
});
export type AdapterDescriptor = z.infer<typeof AdapterDescriptor>;

export interface AdapterContext {
  recorder: RunRecorder;
  logger: Logger;
}

export interface AssertOptions {
  timeoutMs: number;
  /** A failure requires the observed value to be unchanged for this long. */
  stabilityMs: number;
  /** Base URL used to resolve relative expectations (e.g. URL assertions). */
  baseUrl: string;
}

export interface ObserveRequest {
  label?: string;
  reason: "plan" | "failure";
}

export interface AdapterSession {
  /** Environment facts known once the target is connected (e.g. browser version). */
  readonly environment: Pick<RunEnvironment, "adapter" | "browser" | "automation">;
  /** Executes one validated action. Throws if the action fails. */
  execute(action: Action, actionId: string): Promise<void>;
  /**
   * Evaluates one assertion deterministically, retrying until it holds or
   * `timeoutMs` elapses (the semantics of Playwright's `expect`). Never throws
   * for a failed expectation: that is a result, not an exception.
   */
  assert(assertion: Assertion, options: AssertOptions): Promise<AssertionEvaluation>;
  /** Captures the full current state of the target as evidence. */
  observe(request: ObserveRequest): Promise<Observation>;
  /**
   * Writes accumulated evidence (console, network, trace...) to the run.
   * Must be safe to call after a failure and must write whatever it can.
   */
  collectEvidence(): Promise<Record<string, CollectorStatus>>;
  close(): Promise<void>;
}

export interface Adapter {
  readonly descriptor: AdapterDescriptor;
  /** Validated, JSON-serializable configuration; part of the run's configHash. */
  readonly config: Readonly<Record<string, unknown>>;
  start(context: AdapterContext): Promise<AdapterSession>;
}

export function supportsAssertion(descriptor: AdapterDescriptor, assertion: Assertion): boolean {
  return descriptor.assertions.includes(assertion.kind);
}

export function supportsAction(descriptor: AdapterDescriptor, action: Action): boolean {
  return descriptor.actions.includes(action.type);
}
