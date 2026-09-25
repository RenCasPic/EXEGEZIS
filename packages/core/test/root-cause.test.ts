import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMutation,
  applyMutationText,
  classifyAttempt,
  countAttempts,
  createWorkspace,
  decideRootCause,
  evaluatePrediction,
  evaluateRootCause,
  ExperimentArm,
  hashTree,
  Hypothesis,
  hypothesisOutcome,
  removeWorkspace,
  RootCauseInvestigation,
  RootCauseReport,
  type ArmCounts,
  type HypothesisOutcome,
  type RootCauseGroundTruth,
} from "../src/index.js";

const POLICY = { runsPerArm: 5, minRefutedAlternatives: 1 };
const counts = (reproduced: number, notReproduced: number, invalid = 0): ArmCounts => ({
  runs: reproduced + notReproduced + invalid,
  reproduced,
  notReproduced,
  invalid,
});
const BASELINE = counts(5, 0);
const provenance = { source: "model" as const, generator: "anthropic", model: "claude-opus-5", version: null, promptVersion: null, createdAt: null };

const hypothesis = (id: string, file = "src/shop.ts", find = "a", replace = "b") =>
  Hypothesis.parse({
    id,
    statement: `cause ${id}`,
    rationale: "because",
    location: { file },
    intervention: { kind: "replace", file, find, replace, description: "change" },
    prediction: "eliminates",
    provenance,
  });

const outcome = (id: string, status: HypothesisOutcome["status"]): HypothesisOutcome => ({ id, statement: `cause ${id}`, status, experimentId: `EXP-${id}`, reason: "" });

describe("hypotheses", () => {
  it("records a proposal with its intervention and provenance", () => {
    const h = hypothesis("H1");
    expect(h.prediction).toBe("eliminates");
    expect(h.provenance.source).toBe("model");
  });

  it("rejects hypotheses that could smuggle in a verdict or a vague intervention", () => {
    const base = { ...hypothesis("H1") } as Record<string, unknown>;
    expect(Hypothesis.safeParse({ ...base, status: "VALIDATED" }).success).toBe(false);
    expect(Hypothesis.safeParse({ ...base, prediction: "persists" }).success).toBe(false);
    expect(Hypothesis.safeParse({ ...base, id: "cause-1" }).success).toBe(false);
    expect(Hypothesis.safeParse({ ...base, intervention: { kind: "replace", file: "../etc/passwd", find: "a", replace: "b", description: "x" } }).success).toBe(false);
  });

  it("requires each intervention to target the file its hypothesis names, and unique ids", () => {
    const investigation = {
      schemaVersion: "exegezis.root-cause-investigation/v1",
      bugId: "BUG-X",
      plan: "plan.json",
      app: { dir: ".", include: ["src"], command: ["node", "src/server.ts"], portEnv: "PORT", healthPath: "/health" },
      hypotheses: [hypothesis("H1"), hypothesis("H2")],
    };
    expect(RootCauseInvestigation.safeParse(investigation).success).toBe(true);
    expect(RootCauseInvestigation.safeParse({ ...investigation, hypotheses: [hypothesis("H1"), hypothesis("H1")] }).success).toBe(false);
    const mismatched = { ...hypothesis("H3"), location: { file: "public/app.js" } };
    expect(RootCauseInvestigation.safeParse({ ...investigation, hypotheses: [mismatched] }).success).toBe(false);
  });
});

describe("attempt classification and experiment schema", () => {
  it("counts only a failed expectation as the bug showing", () => {
    expect(classifyAttempt({ verdict: "failed", failedPurpose: "expectation" })).toBe("reproduced");
    expect(classifyAttempt({ verdict: "passed" })).toBe("not_reproduced");
    expect(classifyAttempt({ verdict: "failed", failedPurpose: "anchor" })).toBe("invalid");
    expect(classifyAttempt({ verdict: "timeout" })).toBe("invalid");
    expect(classifyAttempt({ verdict: "error" })).toBe("invalid");
  });

  it("rejects an arm whose counts do not add up", () => {
    const arm = { label: "intervention", path: "experiments/H1", mutation: null, counts: counts(1, 4), rate: 0.2, reproductionStatus: "FLAKY", attempts: [], error: null };
    expect(ExperimentArm.safeParse(arm).success).toBe(true);
    expect(ExperimentArm.safeParse({ ...arm, counts: { runs: 5, reproduced: 1, notReproduced: 1, invalid: 0 } }).success).toBe(false);
    expect(countAttempts([{ classification: "reproduced" }, { classification: "invalid" }, { classification: "not_reproduced" }])).toEqual(counts(1, 1, 1));
  });
});

describe("prediction evaluation against the baseline", () => {
  it("confirms when neutralizing the cause removes the bug in every run", () => {
    expect(evaluatePrediction("eliminates", BASELINE, counts(0, 5), POLICY).status).toBe("CONFIRMED");
  });
  it("falsifies when the bug persists in every run", () => {
    expect(evaluatePrediction("eliminates", BASELINE, counts(5, 0), POLICY).status).toBe("FALSIFIED");
  });
  it("is inconclusive for a partial effect, invalid runs, too few runs or no stable baseline", () => {
    expect(evaluatePrediction("eliminates", BASELINE, counts(2, 3), POLICY).status).toBe("INCONCLUSIVE");
    expect(evaluatePrediction("eliminates", BASELINE, counts(0, 4, 1), POLICY).status).toBe("INCONCLUSIVE");
    expect(evaluatePrediction("eliminates", BASELINE, counts(0, 3), POLICY).status).toBe("INCONCLUSIVE");
    expect(evaluatePrediction("eliminates", counts(4, 1), counts(0, 5), POLICY).status).toBe("INCONCLUSIVE");
  });
  it("supports control predictions in the other direction", () => {
    expect(evaluatePrediction("persists", BASELINE, counts(5, 0), POLICY).status).toBe("CONFIRMED");
    expect(evaluatePrediction("persists", BASELINE, counts(0, 5), POLICY).status).toBe("FALSIFIED");
  });
});

describe("root cause decision", () => {
  it("validates the only supported hypothesis when its alternatives were refuted", () => {
    const d = decideRootCause(BASELINE, [outcome("H1", "SUPPORTED"), outcome("H2", "REFUTED")], POLICY);
    expect(d).toMatchObject({ status: "VALIDATED", hypothesisId: "H1" });
  });

  it("negative control: a plausible hypothesis whose intervention changes nothing is refuted, never validated", () => {
    const h = hypothesis("H2");
    const o = hypothesisOutcome(h, { id: "EXP-H2", result: evaluatePrediction("eliminates", BASELINE, counts(5, 0), POLICY) });
    expect(o.status).toBe("REFUTED");
    expect(decideRootCause(BASELINE, [o], POLICY).status).toBe("REFUTED");
  });

  it("does not validate from a single confirming experiment", () => {
    expect(decideRootCause(BASELINE, [outcome("H1", "SUPPORTED")], POLICY).status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("reports INSUFFICIENT_EVIDENCE when experiments do not discriminate", () => {
    const d = decideRootCause(BASELINE, [outcome("H1", "SUPPORTED"), outcome("H2", "SUPPORTED"), outcome("H3", "REFUTED")], POLICY);
    expect(d.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(d.reason).toContain("do not discriminate");
  });

  it("reports INSUFFICIENT_EVIDENCE with unresolved hypotheses or without a stable baseline", () => {
    expect(decideRootCause(BASELINE, [outcome("H1", "SUPPORTED"), outcome("H2", "REFUTED"), outcome("H3", "UNRESOLVED")], POLICY).status).toBe(
      "INSUFFICIENT_EVIDENCE",
    );
    expect(decideRootCause(counts(3, 2), [outcome("H1", "SUPPORTED"), outcome("H2", "REFUTED")], POLICY).status).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("untested hypotheses stay unresolved", () => {
    expect(hypothesisOutcome(hypothesis("H1"), null).status).toBe("UNRESOLVED");
  });
});

describe("report invariants", () => {
  const arm = { label: "baseline", path: "baseline", mutation: null, counts: BASELINE, rate: 1, reproductionStatus: "REPRODUCED", attempts: [], error: null };
  const report = {
    schemaVersion: "exegezis.root-cause-report/v1",
    bugId: "BUG-X",
    planId: "BUG-X",
    planPath: "plan.json",
    policy: POLICY,
    generatedAt: "2026-09-25T00:00:00.000Z",
    exegezisVersion: "0.1.0",
    observations: [],
    hypotheses: [hypothesis("H1"), hypothesis("H2")],
    baseline: arm,
    experiments: [],
    outcomes: [outcome("H1", "UNRESOLVED"), outcome("H2", "UNRESOLVED")],
    decision: { status: "INSUFFICIENT_EVIDENCE", hypothesisId: null, statement: null, reason: "unresolved" },
    isolation: { sourceDir: "app", files: 3, treeHashBefore: "x", treeHashAfter: "x", unchanged: true },
  };

  it("accepts a decision that follows from the outcomes", () => {
    expect(RootCauseReport.safeParse(report).success).toBe(true);
  });

  it("rejects a VALIDATED decision the outcomes do not support (nobody can declare it)", () => {
    const claimed = { ...report, decision: { status: "VALIDATED", hypothesisId: "H1", statement: "cause H1", reason: "the model is sure" } };
    expect(RootCauseReport.safeParse(claimed).success).toBe(false);
  });

  it("rejects a validation if the source tree changed", () => {
    const validated = {
      ...report,
      outcomes: [outcome("H1", "SUPPORTED"), outcome("H2", "REFUTED")],
      decision: { status: "VALIDATED", hypothesisId: "H1", statement: "cause H1", reason: "" },
    };
    expect(RootCauseReport.safeParse(validated).success).toBe(true);
    expect(RootCauseReport.safeParse({ ...validated, isolation: { ...validated.isolation, treeHashAfter: "y", unchanged: false } }).success).toBe(false);
  });
});

describe("ground-truth evaluation", () => {
  const source = "function base(items) {\n  return items.reduce((s, i) => s + i.unit, 0);\n}\nconst round = Math.round(x);\n";
  const truth: RootCauseGroundTruth = {
    schemaVersion: "exegezis.root-cause-ground-truth/v1",
    bugId: "BUG-X",
    statement: "uses unit price",
    locations: [{ file: "src/shop.ts", excerpt: "  return items.reduce((s, i) => s + i.unit, 0);" }],
    expectedStatus: "VALIDATED",
  };
  const report = (validated: string | null, h: ReturnType<typeof hypothesis>[]) => ({
    bugId: "BUG-X",
    hypotheses: h,
    decision: { status: validated === null ? ("INSUFFICIENT_EVIDENCE" as const) : ("VALIDATED" as const), hypothesisId: validated, statement: null, reason: "" },
  });
  const right = hypothesis("H1", "src/shop.ts", "s + i.unit", "s + i.total");
  const wrong = hypothesis("H2", "src/shop.ts", "Math.round(x)", "Math.floor(x)");

  it("marks a validation at the true cause as correct", () => {
    expect(evaluateRootCause(report("H1", [right, wrong]), truth, { "src/shop.ts": source })).toMatchObject({ correct: true, falseValidation: false, matchesExpected: true });
  });
  it("marks a validation elsewhere as a false validation", () => {
    expect(evaluateRootCause(report("H2", [right, wrong]), truth, { "src/shop.ts": source })).toMatchObject({ correct: false, falseValidation: true });
  });
  it("treats an honest unknown as neither correct nor false", () => {
    expect(evaluateRootCause(report(null, [right, wrong]), { ...truth, expectedStatus: "INSUFFICIENT_EVIDENCE" }, { "src/shop.ts": source })).toMatchObject({
      correct: null,
      falseValidation: false,
      matchesExpected: true,
    });
  });
});

describe("mutation isolation", () => {
  let root: string;
  let source: string;
  const original = "export const discount = (x) => Math.round(x);\n";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "exegezis-rc-"));
    source = join(root, "app");
    await mkdir(join(source, "src"), { recursive: true });
    await writeFile(join(source, "src", "shop.ts"), original);
    await writeFile(join(source, "package.json"), "{}\n");
    await writeFile(join(source, "SECRET.md"), "not copied\n");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("mutates only the workspace copy and leaves the source tree byte-identical", async () => {
    const before = await hashTree(source, ["src", "package.json"]);
    const workspace = join(root, "ws");
    await createWorkspace(source, ["src", "package.json"], workspace);
    const result = await applyMutation(workspace, { kind: "replace", file: "src/shop.ts", find: "Math.round(x)", replace: "Math.floor(x)", description: "d" });
    expect(result.ok).toBe(true);
    expect(await readFile(join(workspace, "src", "shop.ts"), "utf8")).toContain("Math.floor(x)");
    expect(await readFile(join(source, "src", "shop.ts"), "utf8")).toBe(original);
    expect((await hashTree(source, ["src", "package.json"])).hash).toBe(before.hash);
    await expect(stat(join(workspace, "SECRET.md"))).rejects.toThrow();
    await removeWorkspace(workspace);
    await expect(stat(workspace)).rejects.toThrow();
  });

  it("refuses ambiguous or escaping mutations and workspaces inside the source", async () => {
    const workspace = join(root, "ws");
    await createWorkspace(source, ["src"], workspace);
    const escape = await applyMutation(workspace, { kind: "replace", file: "../app/src/shop.ts", find: "x", replace: "y", description: "d" });
    expect(escape.ok).toBe(false);
    expect(applyMutationText("a a", { file: "f", find: "a", replace: "b" })).toMatchObject({ ok: false });
    expect(applyMutationText("a", { file: "f", find: "z", replace: "b" })).toMatchObject({ ok: false });
    expect(applyMutationText("a", { file: "f", find: "a", replace: "a" })).toMatchObject({ ok: false });
    await expect(createWorkspace(source, ["src"], join(source, "ws"))).rejects.toThrow();
    expect(await readFile(join(source, "src", "shop.ts"), "utf8")).toBe(original);
  });
});
