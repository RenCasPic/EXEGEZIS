import { z } from "zod";

/*
 * Execution coverage, in V8's own format (Chromium via Playwright, Node via
 * NODE_V8_COVERAGE). Coverage is evidence of RELEVANCE — this code ran in the
 * scenario — never of causality. The root-cause engine uses it for two
 * things only: whether a hypothesis' intervention site executed at all, and
 * whether an intervention changed which functions run in a scenario where the
 * baseline was already correct (see docs/06-root-cause-engine.md).
 */

export const CoverageRange = z.strictObject({
  startOffset: z.int().nonnegative(),
  endOffset: z.int().nonnegative(),
  count: z.int().nonnegative(),
});
export type CoverageRange = z.infer<typeof CoverageRange>;

export const FunctionCoverage = z.strictObject({
  functionName: z.string(),
  ranges: z.array(CoverageRange).min(1),
  isBlockCoverage: z.boolean(),
});
export type FunctionCoverage = z.infer<typeof FunctionCoverage>;

export const ScriptCoverage = z.strictObject({
  /** Workspace-relative file (e.g. `public/app.js`) when it could be mapped, else the raw URL. */
  file: z.string(),
  url: z.string(),
  functions: z.array(FunctionCoverage),
});
export type ScriptCoverage = z.infer<typeof ScriptCoverage>;

export const CoverageFile = z.strictObject({
  schemaVersion: z.literal("exegezis.coverage/v1"),
  runtime: z.enum(["browser", "node"]),
  scripts: z.array(ScriptCoverage),
});
export type CoverageFile = z.infer<typeof CoverageFile>;

/** Executions of the innermost block that contains `offset` (0 if no function covers it). */
export function executionsAt(script: Pick<ScriptCoverage, "functions">, offset: number): number {
  let best: CoverageRange | null = null;
  for (const fn of script.functions) {
    for (const range of fn.ranges) {
      if (offset < range.startOffset || offset >= range.endOffset) continue;
      if (best === null || range.endOffset - range.startOffset <= best.endOffset - best.startOffset) best = range;
    }
  }
  return best?.count ?? 0;
}

/**
 * How many times each function ran, keyed by `file#name` (anonymous functions
 * of a file are summed). Offsets are not part of the key, so a footprint can
 * be compared across two versions of a file.
 */
export type Footprint = Record<string, number>;

export function footprintOf(scripts: readonly Pick<ScriptCoverage, "file" | "functions">[]): Footprint {
  const footprint: Footprint = {};
  for (const script of scripts) {
    for (const fn of script.functions) {
      const first = fn.ranges[0];
      if (first === undefined || (fn.functionName === "" && first.startOffset === 0)) continue; // the module's top level
      const key = `${script.file}#${fn.functionName === "" ? "(anonymous)" : fn.functionName}`;
      footprint[key] = (footprint[key] ?? 0) + first.count;
    }
  }
  return footprint;
}

export function addFootprints(a: Footprint, b: Footprint): Footprint {
  const sum: Footprint = { ...a };
  for (const [k, v] of Object.entries(b)) sum[k] = (sum[k] ?? 0) + v;
  return sum;
}

/** Functions whose execution count differs between two footprints. */
export function footprintDiff(baseline: Footprint, other: Footprint): { key: string; baseline: number; other: number }[] {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(other)]);
  return [...keys]
    .sort()
    .map((key) => ({ key, baseline: baseline[key] ?? 0, other: other[key] ?? 0 }))
    .filter((d) => d.baseline !== d.other);
}
