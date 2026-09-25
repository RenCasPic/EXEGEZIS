import { Provenance, TestPlan } from "@exegezis/core";
import type { PlanGenerationResult } from "@exegezis/planner";
import { z } from "zod";

/**
 * Reader for `generation.json`, the file the CLI writes after one planner
 * call: `{ promptVersion, ...PlanGenerationResult }` (see
 * `apps/cli/src/ai.ts`). The planner defines that result only as a
 * TypeScript type, so this is its runtime check, not a second model: the
 * plan inside is parsed with the canonical `TestPlan` schema.
 */
export const GenerationRecord = z.looseObject({
  promptVersion: z.string(),
  status: z.enum(["generated", "declined", "invalid_generation", "error"]),
  plan: TestPlan.optional(),
  /** declined */
  reason: z.string().optional(),
  /** invalid_generation / error */
  kind: z.string().optional(),
  issues: z.array(z.string()).optional(),
  message: z.string().optional(),
  provenance: Provenance.optional(),
  meta: z
    .looseObject({
      provider: z.string(),
      model: z.string(),
      promptVersion: z.string(),
      latencyMs: z.number(),
      usage: z.strictObject({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
      redactions: z.number(),
      examples: z.number(),
      raw: z.string(),
    })
    .optional(),
});
export type GenerationRecord = z.infer<typeof GenerationRecord>;

// Compile-time link to the planner's own type: if its statuses change, this breaks.
type _SameStatuses = [PlanGenerationResult["status"]] extends [GenerationRecord["status"]]
  ? [GenerationRecord["status"]] extends [PlanGenerationResult["status"]]
    ? true
    : never
  : never;
export const GENERATION_STATUSES_MATCH: _SameStatuses = true;

/** One-line description of what the planner did, from the record alone. */
export function generationDetail(record: GenerationRecord): string | null {
  switch (record.status) {
    case "generated":
      return record.plan === undefined ? null : `${record.plan.id}: ${record.plan.steps.length} steps`;
    case "declined":
      return record.reason ?? null;
    case "invalid_generation":
      return `${record.kind ?? "invalid"}: ${(record.issues ?? []).slice(0, 2).join("; ")}`;
    case "error":
      return `${record.kind ?? "error"}: ${record.message ?? ""}`;
  }
}
