import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Adapter } from "./adapter.js";
import { executeRun } from "./execute.js";
import type { Logger } from "./logger.js";
import { RunRecorder } from "./recorder.js";
import { resolveNavigationUrl } from "./schemas/action.js";
import { AccessibilityFile, NetworkFile } from "./schemas/evidence.js";
import { UNKNOWN_PROVENANCE } from "./schemas/policy.js";
import type { PlanStep, TestPlan } from "./schemas/test-plan.js";
import type { ReferencePage } from "./validation.js";

export interface PreflightOptions {
  plan: TestPlan;
  baseUrl?: string;
  adapter: Adapter;
  /** Directory that will contain the preflight run. */
  outputDir: string;
  createLogger: (recorder: RunRecorder) => Logger;
  exegezisVersion: string;
}

export interface PreflightResult {
  runId: string;
  runDir: string;
  /** Pages observed; empty if the target could not be observed. */
  pages: ReferencePage[];
}

/**
 * Observes, in a fresh context and before the plan runs, every URL the plan
 * navigates to. It performs no action of the plan: it only records what the
 * application shows on arrival and how long it takes, so validation can check
 * targets against reality and timeouts against observed latency.
 */
export async function runPreflight(options: PreflightOptions): Promise<PreflightResult> {
  const baseUrl = options.baseUrl ?? options.plan.target.baseUrl;
  const urls = [
    ...new Set(
      options.plan.steps.flatMap((step) => (step.type === "navigate" ? [resolveNavigationUrl(step.url, baseUrl)] : [])),
    ),
  ];
  const steps: PlanStep[] = urls.flatMap((url, i) => [
    { type: "navigate" as const, url },
    { type: "observe" as const, label: `preflight-${i + 1}` },
  ]);
  const recorder = await RunRecorder.create({ outputDir: options.outputDir });
  if (steps.length === 0) return { runId: recorder.runId, runDir: recorder.dir, pages: [] };

  const outcome = await executeRun({
    adapter: options.adapter,
    plan: {
      schemaVersion: "exegezis.test-plan/v1",
      id: `${options.plan.id}-preflight`,
      title: `Preflight observation for ${options.plan.id}`,
      target: { kind: "web", baseUrl },
      preconditions: [],
      provenance: { ...UNKNOWN_PROVENANCE, source: "tool", generator: "exegezis-preflight" },
      steps,
      metadata: {},
    },
    recorder,
    logger: options.createLogger(recorder),
    command: "preflight",
    exegezisVersion: options.exegezisVersion,
  });

  let accessibility: AccessibilityFile;
  let network: NetworkFile;
  try {
    accessibility = AccessibilityFile.parse(JSON.parse(await readFile(join(outcome.dir, "accessibility.json"), "utf8")));
    network = NetworkFile.parse(JSON.parse(await readFile(join(outcome.dir, "network.json"), "utf8")));
  } catch {
    return { runId: outcome.runId, runDir: outcome.dir, pages: [] };
  }

  // Navigation latency per URL, from the timeline.
  const navigationMs = new Map<string, number>();
  const started = new Map<string, string>();
  for (const event of outcome.timeline) {
    if (event.type === "ACTION_STARTED" && event.payload.step.type === "navigate") {
      started.set(event.payload.actionId, event.payload.step.url);
    }
    if (event.type === "ACTION_SUCCEEDED") {
      const url = started.get(event.payload.actionId);
      if (url !== undefined) navigationMs.set(url, event.payload.durationMs);
    }
  }
  const slowestResponseMs = Math.max(
    0,
    ...network.exchanges
      .filter((e) => e.request.resourceType === "fetch" || e.request.resourceType === "xhr")
      .map((e) => e.durationMs ?? 0),
  );

  const pages: ReferencePage[] = [];
  for (const url of urls) {
    // The snapshot taken right after arriving at this URL.
    const snapshot = accessibility.snapshots.find((s) => s.pageUrl === url);
    if (snapshot === undefined) continue;
    pages.push({
      url,
      accessibility: snapshot.tree,
      latency: { navigationMs: navigationMs.get(url) ?? 0, slowestResponseMs },
    });
  }
  return { runId: outcome.runId, runDir: outcome.dir, pages };
}
