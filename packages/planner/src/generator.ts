import { createHash } from "node:crypto";
import type { AccessibilityNode, ActionType, AssertionKind, Provenance, TestPlan } from "@exegezis/core";
import { assemblePlan, PlannerOutput, toDraftStep } from "./draft.js";
import { PLANNER_V1 } from "./prompts/planner-v1.js";
import { redactionCount, redactText } from "./redact.js";

/** Everything the planner may know. Deliberately small: no run evidence. */
export interface PlanGenerationInput {
  symptom: string;
  target: { kind: "web"; baseUrl: string };
  /** What the adapter can execute; the model must not use anything else. */
  capabilities: { actions: readonly ActionType[]; assertions: readonly AssertionKind[] };
  /** The application's initial page, as observed by the preflight. */
  observations?: readonly { url: string; accessibility: readonly AccessibilityNode[] }[];
  /** Solved examples (symptom → plan) for the same application. Never the case being evaluated. */
  examples?: readonly PlanExample[];
  /** Id for the generated plan; derived from the symptom when absent. */
  planId?: string;
}

export interface PlanExample {
  symptom: string;
  plan: TestPlan;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * The generator's result. It is a *proposal* at best: nothing here says
 * whether a bug exists. That is decided only by the verification engine.
 */
export type PlanGenerationResult =
  | {
      status: "generated";
      plan: TestPlan;
      provenance: Provenance;
      meta: GenerationMeta;
    }
  | {
      /** The model explicitly declined: the symptom is not testable as written. */
      status: "declined";
      reason: string;
      provenance: Provenance;
      meta: GenerationMeta;
    }
  | {
      /** The response could not become a TestPlan. Never repaired silently. */
      status: "invalid_generation";
      kind: "invalid_json" | "schema_violation" | "missing_plan" | "truncated" | "refused";
      issues: string[];
      provenance: Provenance;
      meta: GenerationMeta;
    }
  | {
      /** No response: missing credentials or a provider failure. */
      status: "error";
      kind: "configuration" | "provider";
      message: string;
    };

export interface GenerationMeta {
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  usage: TokenUsage | null;
  /** Items redacted from the input before it was sent to the provider. */
  redactions: number;
  examples: number;
  /** Raw model output, kept for audit. */
  raw: string;
}

export interface PlanGenerator {
  readonly provider: string;
  generate(input: PlanGenerationInput): Promise<PlanGenerationResult>;
}

/** A completed model call, provider-agnostic. */
export interface ModelResponse {
  text: string;
  /** The model that actually served the request, as reported by the provider. */
  model: string;
  stopReason: "end" | "max_tokens" | "refusal" | "other";
  usage: TokenUsage | null;
}

export interface ModelRequest {
  system: string;
  user: string;
}

/** The only provider-specific part: one request, one response. */
export interface ModelClient {
  readonly provider: string;
  /** The model requested (the response reports the one that served it). */
  readonly model: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/** Thrown by a ModelClient when it cannot be used (e.g. no credentials). */
export class PlannerConfigurationError extends Error {
  override readonly name = "PlannerConfigurationError";
}

export const PROMPT = PLANNER_V1;

/**
 * The generation pipeline, identical for every provider (the mock included):
 * redact → prompt → one model call → JSON.parse → PlannerOutput (Zod) →
 * TestPlan (Zod). Exactly one call: no retries, no repair, no agent loop.
 */
export class ModelPlanGenerator implements PlanGenerator {
  constructor(private readonly client: ModelClient) {}

  get provider(): string {
    return this.client.provider;
  }

  async generate(input: PlanGenerationInput): Promise<PlanGenerationResult> {
    const symptom = redactText(input.symptom);
    const user = buildUserMessage({ ...input, symptom: symptom.text });
    const started = performance.now();

    let response: ModelResponse;
    try {
      response = await this.client.complete({ system: PROMPT.system, user });
    } catch (error) {
      return {
        status: "error",
        kind: error instanceof PlannerConfigurationError ? "configuration" : "provider",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const provenance: Provenance = {
      source: "model",
      generator: this.client.provider,
      model: response.model,
      version: null,
      promptVersion: PROMPT.version,
      createdAt: new Date().toISOString(),
    };
    const meta: GenerationMeta = {
      provider: this.client.provider,
      model: response.model,
      promptVersion: PROMPT.version,
      latencyMs: Math.round(performance.now() - started),
      usage: response.usage,
      redactions: redactionCount(symptom),
      examples: input.examples?.length ?? 0,
      raw: response.text,
    };
    const invalid = (kind: "invalid_json" | "schema_violation" | "missing_plan" | "truncated" | "refused", issues: string[]): PlanGenerationResult => ({
      status: "invalid_generation",
      kind,
      issues,
      provenance,
      meta,
    });

    if (response.stopReason === "refusal") return invalid("refused", ["the model refused the request"]);
    if (response.stopReason === "max_tokens") return invalid("truncated", ["the response hit max_tokens and is incomplete"]);

    let json: unknown;
    try {
      json = JSON.parse(response.text);
    } catch (error) {
      return invalid("invalid_json", [error instanceof Error ? error.message : String(error)]);
    }
    const output = PlannerOutput.safeParse(json);
    if (!output.success) return invalid("schema_violation", formatIssues(output.error.issues));

    if (output.data.plan === undefined) {
      const reason = output.data.cannotPlanReason?.trim();
      return reason === undefined || reason === ""
        ? invalid("missing_plan", ["the response contains neither a plan nor a reason for not writing one"])
        : { status: "declined", reason, provenance, meta };
    }

    const plan = assemblePlan(output.data.plan, {
      planId: input.planId ?? planIdFor(input.symptom),
      baseUrl: input.target.baseUrl,
      provenance,
      symptom: symptom.text,
    });
    if (!plan.success) return invalid("schema_violation", formatIssues(plan.error.issues));
    return { status: "generated", plan: plan.data, provenance, meta };
  }
}

/** Stable id derived from the symptom: the same symptom always names the same plan. */
export function planIdFor(symptom: string): string {
  return `AI-${createHash("sha256").update(symptom.trim()).digest("hex").slice(0, 10)}`;
}

function formatIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string[] {
  return issues.slice(0, 20).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
}

/** The user message: context first (stable), the symptom last. */
export function buildUserMessage(input: PlanGenerationInput): string {
  const parts: string[] = [];
  parts.push(`Application under test: a web application at ${input.target.baseUrl}`);
  parts.push(`Supported actions: ${input.capabilities.actions.join(", ")}`);
  parts.push(`Supported assertions: ${input.capabilities.assertions.join(", ")}`);
  for (const page of input.observations ?? []) {
    const tree = redactText(renderAccessibilityTree(page.accessibility)).text;
    parts.push(`Accessibility tree of ${page.url} right after loading it (before any action):\n${tree}`);
  }
  for (const [i, example] of (input.examples ?? []).entries()) {
    parts.push(
      `Example ${i + 1} (same application, a different symptom):\nSymptom: ${redactText(example.symptom).text}\nPlan:\n${JSON.stringify(toDraft(example.plan), null, 1)}`,
    );
  }
  parts.push(`Symptom to test:\n${input.symptom}`);
  return parts.join("\n\n");
}

/** The draft form of an existing plan, as the model is asked to write it. */
function toDraft(plan: TestPlan): unknown {
  return {
    plan: {
      title: plan.title,
      description: plan.description ?? "",
      preconditions: plan.preconditions,
      steps: plan.steps.map(toDraftStep).filter((step) => step !== undefined),
    },
  };
}

/** Compact, indented text form of an accessibility tree (`- button "Checkout"`). */
export function renderAccessibilityTree(nodes: readonly AccessibilityNode[], depth = 0): string {
  const lines: string[] = [];
  for (const node of nodes) {
    const name = node.name === undefined ? "" : ` "${node.name}"`;
    const text = node.text === undefined ? "" : `: ${node.text}`;
    lines.push(`${"  ".repeat(depth)}- ${node.role}${name}${text}`);
    if (node.children !== undefined) lines.push(renderAccessibilityTree(node.children, depth + 1));
  }
  return lines.filter((l) => l !== "").join("\n");
}
