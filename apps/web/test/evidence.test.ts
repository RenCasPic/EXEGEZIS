import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discover } from "../src/lib/evidence/discover";
import { loadSummaries, type InvestigationSummary } from "../src/lib/evidence/investigations";
import { deriveStages, NOT_IMPLEMENTED_STAGES, type StageInput } from "../src/lib/evidence/stages";
import { matchesStatus } from "../src/lib/filters";
import { environmentOf } from "../src/lib/projects";
import { isInside } from "../src/lib/workspace";

const BASE: StageInput = {
  symptom: "The counter is wrong.",
  planSource: "model",
  generation: { status: "generated" },
  generationDetail: "AI-1: 7 steps",
  outcome: "VERIFIED",
  executed: true,
  outcomeReason: "every verification criterion is met",
  outcomeMessage: null,
  reproduction: { failures: 10, attempts: 10 },
  running: false,
  evidenceOnDisk: true,
  archived: false,
  rootCause: null,
};

const statusOf = (input: StageInput, id: string) => deriveStages(input).find((s) => s.id === id)?.status;

describe("deriveStages", () => {
  it("shows the real verdict, NOT RUN for an uninvestigated root cause and NOT IMPLEMENTED for fixes", () => {
    const stages = deriveStages(BASE);
    expect(stages.map((s) => s.status)).toEqual(["PROVIDED", "GENERATED", "VERIFIED", "AVAILABLE", "NOT_RUN", "NOT_RUN", "NOT_IMPLEMENTED", "NOT_IMPLEMENTED"]);
    expect(NOT_IMPLEMENTED_STAGES).toEqual(["fix", "verification"]);
    for (const id of NOT_IMPLEMENTED_STAGES) expect(stages.find((s) => s.id === id)?.tone).toBe("unimplemented");
  });

  it("shows the root-cause decision exactly as recorded", () => {
    const rc = { status: "VALIDATED" as const, experiments: 3, hypotheses: 3, reason: "H1 is the only hypothesis..." };
    expect(statusOf({ ...BASE, rootCause: rc }, "investigation")).toBe("EXPERIMENTS");
    expect(statusOf({ ...BASE, rootCause: rc }, "root_cause")).toBe("VALIDATED");
    expect(statusOf({ ...BASE, rootCause: { ...rc, status: "INSUFFICIENT_EVIDENCE" } }, "root_cause")).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("never reports a reproduction for a plan that was not executed", () => {
    const declined: StageInput = { ...BASE, generation: { status: "declined" }, outcome: "INCONCLUSIVE", executed: false, reproduction: null, evidenceOnDisk: false };
    expect(statusOf(declined, "plan")).toBe("DECLINED");
    expect(statusOf(declined, "reproduction")).toBe("NOT_RUN");
    expect(statusOf(declined, "evidence")).toBe("AWAITING_EVIDENCE");
  });

  it("says archived evidence is not archived instead of pretending it exists", () => {
    expect(statusOf({ ...BASE, archived: true, evidenceOnDisk: false }, "evidence")).toBe("NOT_ARCHIVED");
  });

  it("labels human plans and running jobs", () => {
    expect(statusOf({ ...BASE, generation: null, planSource: "human" }, "plan")).toBe("HUMAN_PLAN");
    expect(statusOf({ ...BASE, outcome: null, executed: false, reproduction: null, running: true, evidenceOnDisk: false }, "reproduction")).toBe("RUNNING");
  });
});

describe("workspace helpers", () => {
  it("keeps paths inside their directory", () => {
    expect(isInside("/a/b", "/a/b/c/d.json")).toBe(true);
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b", "/a/b/../c")).toBe(false);
    expect(isInside("/a/b", "/a/bc")).toBe(false);
  });

  it("derives the environment from the target URL only", () => {
    expect(environmentOf("http://127.0.0.1:4000/")).toBe("Local");
    expect(environmentOf("http://localhost:3000/")).toBe("Local");
    expect(environmentOf("https://staging.example.com/")).toBe("staging.example.com");
    expect(environmentOf(null)).toBeNull();
  });
});

/*
 * Against the results committed in benchmarks/buggy-shop-ai/results (the
 * Iteration 3 checkpoint). runs/ is replaced by an empty directory so the
 * test does not depend on local runs.
 */
describe("discovery of the archived Benchmark B results", () => {
  let emptyRuns: string;
  let summaries: InvestigationSummary[];
  const previous = process.env.EXEGEZIS_RUNS_DIR;

  beforeAll(async () => {
    emptyRuns = await mkdtemp(join(tmpdir(), "exegezis-web-"));
    process.env.EXEGEZIS_RUNS_DIR = emptyRuns;
    const index = await discover();
    summaries = await loadSummaries(index);
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.EXEGEZIS_RUNS_DIR;
    else process.env.EXEGEZIS_RUNS_DIR = previous;
    await rm(emptyRuns, { recursive: true, force: true });
  });

  it("finds both archived runs and their 14 cases", async () => {
    const index = await discover();
    expect(index.benchmarks.map((b) => b.id).sort()).toEqual([
      "buggy-shop-ai~2026-09-25-claude-opus-5-planner-v1-with-examples",
      "buggy-shop-ai~2026-09-25-claude-opus-5-planner-v1-without-examples",
    ]);
    expect(index.benchmarks.every((b) => b.archived && b.result.status === "ok")).toBe(true);
    expect(summaries).toHaveLength(14);
    expect(summaries.every((s) => s.problems.length === 0)).toBe(true);
  });

  it("reports exactly the recorded verdicts and never a VERIFIED negative case", () => {
    const verified = summaries.filter((s) => matchesStatus(s, "verified"));
    expect(verified.map((s) => s.ref.caseId).sort()).toEqual(["BUG-001", "BUG-001", "BUG-002", "BUG-002", "BUG-003", "BUG-003"]);
    expect(summaries.filter((s) => s.benchmark?.kind === "negative" && s.outcome === "VERIFIED")).toHaveLength(0);
  });

  it("keeps model provenance, links the archived root-cause result and marks fixes NOT IMPLEMENTED", () => {
    const bug = summaries.find((s) => s.ref.caseId === "BUG-002");
    expect(bug?.provenance).toMatchObject({ source: "model", generator: "anthropic", model: "claude-opus-5", promptVersion: "planner-v1" });
    expect(bug?.project).toBe("buggy-shop");
    expect(bug?.rootCause).toMatchObject({ status: "VALIDATED", hypothesisId: "H1" });
    expect(bug?.stages.find((st) => st.id === "root_cause")?.status).toBe("VALIDATED");
    expect(bug?.rootCause?.evidenceLevel).toBe("VALIDATED");
    expect(summaries.find((s) => s.ref.caseId === "BUG-003")?.rootCause?.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(summaries.find((s) => s.ref.caseId === "HEALTHY-001")?.rootCause).toBeNull();
    for (const s of summaries) {
      for (const id of NOT_IMPLEMENTED_STAGES) expect(s.stages.find((st) => st.id === id)?.status).toBe("NOT_IMPLEMENTED");
    }
  });

  it("shows declined cases as not executed, with no evidence", () => {
    const ambiguous = summaries.filter((s) => s.ref.caseId === "AMBIGUOUS-001");
    expect(ambiguous).toHaveLength(2);
    for (const s of ambiguous) {
      expect(s.generation?.status).toBe("declined");
      expect(s.outcomeSource).toBe("benchmark");
      expect(s.stages.find((st) => st.id === "reproduction")?.status).toBe("NOT_RUN");
      expect(s.evidenceOnDisk).toBe(false);
    }
  });
});
