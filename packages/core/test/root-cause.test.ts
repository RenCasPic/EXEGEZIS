import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMutation,
  applyMutationText,
  classifyAttempt,
  controlPlan,
  countAttempts,
  createWorkspace,
  decideRootCause,
  DEFAULT_ROOT_CAUSE_POLICY,
  evaluatePrediction,
  evaluateRootCause,
  evidenceMatrix,
  executionsAt,
  ExperimentArm,
  footprintDiff,
  footprintOf,
  hashTree,
  Hypothesis,
  hypothesisOutcome,
  removeWorkspace,
  RootCauseInvestigation,
  RootCauseReport,
  siteExecutions,
  specificityOf,
  TestPlan,
  type ArmCounts,
  type ControlArm,
  type Experiment,
  type HypothesisOutcome,
  type RootCauseGroundTruth,
} from "../src/index.js";

const POLICY = DEFAULT_ROOT_CAUSE_POLICY;
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

const arm = (c: ArmCounts, label: ExperimentArm["label"] = "intervention", control: ControlArm | null = null): ExperimentArm => ({
  label,
  path: label,
  mutation: null,
  counts: c,
  rate: c.runs === 0 ? 0 : c.reproduced / c.runs,
  reproductionStatus: c.reproduced === c.runs ? "REPRODUCED" : c.reproduced === 0 ? "NOT_REPRODUCED" : "FLAKY",
  attempts: [],
  footprint: null,
  coverage: null,
  control,
  error: null,
});

const control = (footprint: Record<string, number> | null, passed = 2): ControlArm => ({ path: "control", runs: 2, passed, footprint, stable: true, error: null });
const CONTROL = control({ "public/app.js#renderBadge": 4, "public/app.js#renderCart": 4 });

/** An experiment with every piece of evidence, each overridable. */
const experiment = (id: string, over: Partial<Pick<Experiment, "result" | "site" | "specificity" | "reversal">> = {}): Pick<Experiment, "hypothesisId" | "result" | "site" | "specificity" | "reversal"> => ({
  hypothesisId: id,
  result: { status: "CONFIRMED", reason: "0/5" },
  site: { file: "public/app.js", offset: 10, executions: 5 },
  specificity: specificityOf(CONTROL, CONTROL),
  reversal: arm(counts(5, 0), "reversal"),
  ...over,
});

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
    expect(RootCauseInvestigation.parse(investigation).policy).toEqual(DEFAULT_ROOT_CAUSE_POLICY);
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
    const a = arm(counts(1, 4));
    expect(ExperimentArm.safeParse(a).success).toBe(true);
    expect(ExperimentArm.safeParse({ ...a, counts: { runs: 5, reproduced: 1, notReproduced: 1, invalid: 0 } }).success).toBe(false);
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
});

describe("execution coverage (relevance, not causality)", () => {
  const script = {
    file: "public/app.js",
    functions: [
      { functionName: "", ranges: [{ startOffset: 0, endOffset: 100, count: 1 }], isBlockCoverage: true },
      { functionName: "remove", ranges: [{ startOffset: 10, endOffset: 40, count: 3 }, { startOffset: 20, endOffset: 30, count: 0 }], isBlockCoverage: true },
      { functionName: "render", ranges: [{ startOffset: 50, endOffset: 70, count: 4 }], isBlockCoverage: true },
    ],
  };
  it("reads the executions of the innermost block at an offset", () => {
    expect(executionsAt(script, 15)).toBe(3);
    expect(executionsAt(script, 25)).toBe(0);
    expect(executionsAt(script, 80)).toBe(1);
    expect(siteExecutions([{ ...script, url: "x" }], "public/app.js", 55)).toBe(4);
    expect(siteExecutions(null, "public/app.js", 55)).toBeNull();
    // A file missing from the coverage is unmeasured, never "0 executions".
    expect(siteExecutions([{ ...script, url: "x" }], "src/shop.ts", 55)).toBeNull();
  });
  it("builds footprints by function name, ignoring the module top level, and diffs them", () => {
    expect(footprintOf([script])).toEqual({ "public/app.js#remove": 3, "public/app.js#render": 4 });
    expect(footprintDiff({ a: 1, b: 2 }, { a: 1, b: 3, c: 1 })).toEqual([
      { key: "b", baseline: 2, other: 3 },
      { key: "c", baseline: 0, other: 1 },
    ]);
  });
});

describe("specificity: removing a cause vs adding a compensating change", () => {
  it("is surgical when the control scenario executes exactly the same", () => {
    expect(specificityOf(CONTROL, control({ ...CONTROL.footprint })).status).toBe("surgical");
  });
  it("is not surgical when the intervention changes execution where the baseline is correct", () => {
    const s = specificityOf(CONTROL, control({ "public/app.js#renderBadge": 8, "public/app.js#renderCart": 4 }));
    expect(s.status).toBe("not_surgical");
    expect(s.changed).toEqual([{ key: "public/app.js#renderBadge", baseline: 4, other: 8 }]);
  });
  it("is not surgical when the intervention breaks the control scenario", () => {
    expect(specificityOf(CONTROL, control(CONTROL.footprint, 1)).status).toBe("not_surgical");
  });
  it("is unknown without a control scenario, coverage or a stable measure", () => {
    expect(specificityOf(null, CONTROL).status).toBe("unknown");
    expect(specificityOf(CONTROL, control(null)).status).toBe("unknown");
    expect(specificityOf(CONTROL, { ...CONTROL, stable: false }).status).toBe("unknown");
    expect(specificityOf(control(CONTROL.footprint, 1), CONTROL).status).toBe("unknown");
  });
  it("treats a file missing from one measure as a measurement gap, not as a behaviour change", () => {
    const withServer = control({ ...CONTROL.footprint, "src/server.ts#handleApi": 8 });
    const s = specificityOf(withServer, CONTROL);
    expect(s.status).toBe("unknown");
    expect(s.reason).toContain("src/server.ts");
  });
});

describe("control scenario", () => {
  const plan = TestPlan.parse({
    schemaVersion: "exegezis.test-plan/v1",
    id: "BUG-X",
    title: "t",
    target: { kind: "web", baseUrl: "http://localhost/" },
    steps: [
      { type: "navigate", url: "/" },
      { type: "assert", id: "a1", purpose: "anchor", assertion: { kind: "url", expected: "/" } },
      { type: "click", target: { role: "button", name: "Add" } },
      { type: "assert", id: "a2", purpose: "anchor", assertion: { kind: "url", expected: "/" } },
      { type: "click", target: { role: "button", name: "Remove" } },
      { type: "assert", id: "a3", purpose: "anchor", assertion: { kind: "url", expected: "/" } },
      { type: "assert", id: "e1", purpose: "expectation", assertion: { kind: "url", expected: "/" } },
    ],
  });
  it("cuts the plan at the last anchor before the action that precedes the failure", () => {
    const c = controlPlan(plan, 7);
    expect(c?.steps).toHaveLength(4);
    expect(c?.id).toBe("BUG-X-control");
  });
  it("returns null when no anchor precedes the triggering action", () => {
    expect(controlPlan(plan, 3)).toBeNull();
  });
});

describe("root cause decision", () => {
  const outcomes = [outcome("H1", "SUPPORTED"), outcome("H2", "REFUTED")];

  it("validates only when every required piece of evidence is met", () => {
    const d = decideRootCause(arm(BASELINE, "baseline"), [experiment("H1")], outcomes, POLICY);
    expect(d).toMatchObject({ status: "VALIDATED", hypothesisId: "H1", evidenceLevel: "VALIDATED", missing: [] });
  });

  it("PROPERTY: an intervention that merely removes the symptom does not imply a root cause", () => {
    // Sufficiency, a confirmed prediction and refuted alternatives are not enough on their own.
    const notSurgical = experiment("H1", { specificity: specificityOf(CONTROL, control({ "public/app.js#renderBadge": 8, "public/app.js#renderCart": 4 })) });
    const noControl = experiment("H1", { specificity: specificityOf(null, null) });
    const noReversal = experiment("H1", { reversal: null });
    const reversalFailed = experiment("H1", { reversal: arm(counts(3, 2), "reversal") });
    const siteNotRun = experiment("H1", { site: { file: "public/app.js", offset: 10, executions: 0 } });
    const noCoverage = experiment("H1", { site: { file: "public/app.js", offset: 10, executions: null } });
    for (const e of [notSurgical, noControl, noReversal, reversalFailed, siteNotRun, noCoverage]) {
      const d = decideRootCause(arm(BASELINE, "baseline"), [e], outcomes, POLICY);
      expect(d.status).toBe("INSUFFICIENT_EVIDENCE");
      expect(d.evidenceLevel).toBe("CANDIDATE");
      expect(d.hypothesisId).toBeNull();
      expect(d.candidateHypothesisId).toBe("H1");
      expect(d.missing.length).toBeGreaterThan(0);
    }
  });

  it("negative control: a plausible hypothesis whose intervention changes nothing is refuted, never validated", () => {
    const o = hypothesisOutcome(hypothesis("H2"), { id: "EXP-H2", result: evaluatePrediction("eliminates", BASELINE, counts(5, 0), POLICY) });
    expect(o.status).toBe("REFUTED");
    expect(decideRootCause(arm(BASELINE, "baseline"), [], [o], POLICY).status).toBe("REFUTED");
  });

  it("does not validate from a single confirming experiment", () => {
    const d = decideRootCause(arm(BASELINE, "baseline"), [experiment("H1")], [outcome("H1", "SUPPORTED")], POLICY);
    expect(d).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", evidenceLevel: "SUFFICIENT", candidateHypothesisId: "H1" });
  });

  it("reports INSUFFICIENT_EVIDENCE when experiments do not discriminate", () => {
    const d = decideRootCause(arm(BASELINE, "baseline"), [experiment("H1"), experiment("H2")], [outcome("H1", "SUPPORTED"), outcome("H2", "SUPPORTED"), outcome("H3", "REFUTED")], POLICY);
    expect(d.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(d.reason).toContain("do not discriminate");
    expect(d.candidateHypothesisId).toBeNull();
  });

  it("reports INSUFFICIENT_EVIDENCE with unresolved hypotheses or without a stable baseline", () => {
    expect(decideRootCause(arm(BASELINE, "baseline"), [experiment("H1")], [...outcomes, outcome("H3", "UNRESOLVED")], POLICY).status).toBe("INSUFFICIENT_EVIDENCE");
    expect(decideRootCause(arm(counts(3, 2), "baseline"), [experiment("H1")], outcomes, POLICY)).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", evidenceLevel: "NONE" });
  });

  it("exposes the evidence matrix, and never claims the hypothesis space is complete", () => {
    const { items } = evidenceMatrix({ baseline: arm(BASELINE, "baseline"), experiments: [experiment("H1")], outcomes, policy: POLICY });
    expect(items.map((i) => i.id)).toEqual([
      "bug_reproduced",
      "site_executed",
      "intervention_removes_bug",
      "prediction_confirmed",
      "reversal_restores_bug",
      "intervention_surgical",
      "alternatives_refuted",
      "unique_survivor",
      "hypothesis_space_complete",
    ]);
    expect(items.find((i) => i.id === "hypothesis_space_complete")).toMatchObject({ status: "unknown", required: false });
    expect(items.filter((i) => i.required).every((i) => i.status === "met")).toBe(true);
  });

  it("untested hypotheses stay unresolved", () => {
    expect(hypothesisOutcome(hypothesis("H1"), null).status).toBe("UNRESOLVED");
  });
});

describe("report invariants: the decision cannot be declared", () => {
  const full = (e: ReturnType<typeof experiment>) => ({
    id: `EXP-${e.hypothesisId}`,
    intervention: hypothesis(e.hypothesisId).intervention,
    prediction: "eliminates" as const,
    baseline: BASELINE,
    arm: arm(counts(0, 5), "intervention", CONTROL),
    delta: -1,
    startedAt: "2026-09-25T00:00:00.000Z",
    finishedAt: "2026-09-25T00:00:00.000Z",
    ...e,
  });
  const baselineArm = arm(BASELINE, "baseline", CONTROL);
  const build = (experiments: ReturnType<typeof full>[], outcomes: HypothesisOutcome[]) => {
    const decision = decideRootCause(baselineArm, experiments, outcomes, POLICY);
    return {
      schemaVersion: "exegezis.root-cause-report/v2",
      bugId: "BUG-X",
      planId: "BUG-X",
      planPath: "plan.json",
      policy: POLICY,
      generatedAt: "2026-09-25T00:00:00.000Z",
      exegezisVersion: "0.1.0",
      observations: [],
      hypotheses: [hypothesis("H1"), hypothesis("H2")],
      baseline: baselineArm,
      experiments,
      outcomes,
      evidence: evidenceMatrix({ baseline: baselineArm, experiments, outcomes, policy: POLICY }).items,
      decision,
      isolation: { sourceDir: "app", files: 3, treeHashBefore: "x", treeHashAfter: "x", unchanged: true },
    };
  };
  const validated = build([full(experiment("H1"))], [outcome("H1", "SUPPORTED"), outcome("H2", "REFUTED")]);

  it("accepts a decision that follows from the measurements", () => {
    expect(validated.decision.status).toBe("VALIDATED");
    expect(RootCauseReport.safeParse(validated).success).toBe(true);
  });

  it("rejects a VALIDATED decision the measurements do not support (nobody can declare it)", () => {
    const candidate = build([full(experiment("H1", { reversal: null }))], [outcome("H1", "SUPPORTED"), outcome("H2", "REFUTED")]);
    expect(candidate.decision.status).toBe("INSUFFICIENT_EVIDENCE");
    const forged = { ...candidate, decision: { ...candidate.decision, status: "VALIDATED", hypothesisId: "H1", evidenceLevel: "VALIDATED", missing: [] } };
    expect(RootCauseReport.safeParse(forged).success).toBe(false);
  });

  it("rejects a specificity claim that does not follow from the recorded control footprints", () => {
    const e = full(experiment("H1"));
    const tampered = { ...validated, experiments: [{ ...e, arm: arm(counts(0, 5), "intervention", control({ "public/app.js#renderBadge": 8, "public/app.js#renderCart": 4 })) }] };
    expect(RootCauseReport.safeParse(tampered).success).toBe(false);
  });

  it("rejects a validation if the source tree changed", () => {
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
  const decision = (status: "VALIDATED" | "INSUFFICIENT_EVIDENCE", id: string | null, candidate: string | null) => ({
    status,
    hypothesisId: id,
    candidateHypothesisId: candidate,
    evidenceLevel: status === "VALIDATED" ? ("VALIDATED" as const) : ("CANDIDATE" as const),
    statement: null,
    reason: "",
    missing: [],
  });
  const right = hypothesis("H1", "src/shop.ts", "s + i.unit", "s + i.total");
  const wrong = hypothesis("H2", "src/shop.ts", "Math.round(x)", "Math.floor(x)");
  const sources = { "src/shop.ts": source };

  it("marks a validation at the true cause as correct", () => {
    expect(evaluateRootCause({ bugId: "BUG-X", hypotheses: [right, wrong], decision: decision("VALIDATED", "H1", "H1") }, truth, sources)).toMatchObject({
      correct: true,
      falseValidation: false,
      matchesExpected: true,
    });
  });
  it("marks a validation elsewhere as a false validation", () => {
    expect(evaluateRootCause({ bugId: "BUG-X", hypotheses: [right, wrong], decision: decision("VALIDATED", "H2", "H2") }, truth, sources)).toMatchObject({
      correct: false,
      falseValidation: true,
    });
  });
  it("treats an honest unknown as neither correct nor false, and still scores the candidate", () => {
    expect(
      evaluateRootCause({ bugId: "BUG-X", hypotheses: [right, wrong], decision: decision("INSUFFICIENT_EVIDENCE", null, "H2") }, { ...truth, expectedStatus: "INSUFFICIENT_EVIDENCE" }, sources),
    ).toMatchObject({ correct: null, falseValidation: false, matchesExpected: true, candidateCorrect: false });
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
