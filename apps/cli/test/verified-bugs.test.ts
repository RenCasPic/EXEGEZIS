import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { BenchmarkResult, BugReport, Reproduction } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main } from "../src/main.js";

/**
 * End-to-end against the evidence lab: the real buggy-shop server, the real
 * CLI, Chromium, and the standard Playwright runner for compiled specs.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHOP = join(REPO, "examples/buggy-shop");
const CASES = "benchmarks/buggy-shop/cases";
/** Inside the repo so compiled specs resolve @playwright/test like a customer project. */
const WORK = join(REPO, "apps/cli/test/.tmp");

let shop: ChildProcess;
let baseUrl: string;

async function freePort(): Promise<number> {
  return new Promise((resolvePort) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolvePort(port));
    });
  });
}

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/`;
  shop = spawn(process.execPath, ["src/server.ts"], { cwd: SHOP, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${baseUrl}api/health`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error("buggy-shop did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
});

afterAll(() => {
  shop.kill();
  rmSync(WORK, { recursive: true, force: true });
});

async function cli(argv: string[], cwd = REPO): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const stderrStream = new PassThrough();
  stderrStream.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const code = await main(argv, { stdout: { write: (text: string) => (stdout += text) }, stderr: stderrStream, cwd });
  return { code, stdout, stderr };
}

function onlyDir(parent: string): string {
  const entries = readdirSync(parent);
  expect(entries).toHaveLength(1);
  return join(parent, entries[0] ?? "");
}

function writePlan(name: string, plan: unknown): string {
  const path = join(WORK, name);
  writeFileSync(path, JSON.stringify(plan));
  return path;
}

describe.each([
  ["BUG-001", 9, "Cart (0)", "Cart (1)"],
  ["BUG-002", 10, { body: { pointer: "/discountCents", equals: 1798 } }, { status: 200, body: { pointer: "/discountCents", value: 899 } }],
  ["BUG-003", 10, "absent", "present"],
] as const)("%s", (bugId, step, expected, actual) => {
  it("is a VERIFIED BUG: valid, anchored, reproduced, evidenced, and failed by its compiled Playwright test", async () => {
    const output = join(WORK, `verify-${bugId}`);
    const { code, stdout } = await cli(["verify", "--plan", `${CASES}/${bugId}/plan.json`, "--runs", "3", "--base-url", baseUrl, "--output", output]);
    expect(code, stdout).toBe(0);
    expect(stdout).toContain("VERIFIED BUG");
    expect(stdout).toContain("Provenance: human (exegezis-team)");
    expect(stdout).toContain("3 / 3 failed (100%) — REPRODUCED");
    expect(stdout).toContain(`FAIL before fix (Playwright failed at step ${step})`);

    const dir = onlyDir(join(output, "verifications"));
    const report = BugReport.parse(JSON.parse(readFileSync(join(dir, "bug-report.json"), "utf8")));
    expect(report).toMatchObject({
      bugId,
      outcome: "VERIFIED",
      provenance: { source: "human", generator: "exegezis-team" },
      validation: { status: "valid" },
      failingStep: { index: step },
      reproduction: { status: "REPRODUCED", attempts: 3, failures: 3, timeouts: 0, errors: 0, rate: 1 },
      compiledTest: { status: "failed", failedAtStep: step, runner: "@playwright/test 1.63.0" },
    });
    expect(report.validation.reference?.targetsChecked).toBeGreaterThan(0);
    expect(report.expected?.value).toEqual(expected);
    expect(report.actual?.value).toEqual(actual);
    for (const ref of report.evidence) expect(() => readFileSync(join(dir, ref.path)), ref.path).not.toThrow();
  });
});

describe("run, reproduce and validate", () => {
  it("run prints anchors and expectations and stops at the failed expectation", async () => {
    const { code, stdout } = await cli(["run", "--plan", `${CASES}/BUG-001/plan.json`, "--base-url", baseUrl, "--output", join(WORK, "run")]);
    expect(code).toBe(1);
    expect(stdout).toMatch(/STEP 5 +ANCHOR The cart badge displays Cart \(1\) after adding one item\n +PASS/);
    expect(stdout).toMatch(/STEP 9 +EXPECT Cart badge displays "Cart \(0\)" after removing the only item\n +FAIL\n +expected "Cart \(0\)"\n +actual +"Cart \(1\)"/);
    expect(stdout).toContain("PLAN_FAILED at step 9 (5 passed, 1 failed, 0 timed out, 0 errors, 0 not run)");
    expect(stdout).toContain("That alone does not prove a bug");
  });

  it("run reports an element that never appears as a timeout (exit 4)", async () => {
    const { code, stdout } = await cli(["run", "--plan", `${CASES}/TIMEOUT-001/plan.json`, "--base-url", baseUrl, "--output", join(WORK, "run-timeout")]);
    expect(code).toBe(4);
    expect(stdout).toMatch(/TIMEOUT +subject_absent/);
    expect(stdout).toContain("PLAN_TIMEOUT at step 7");
  });

  it("run refuses an unsupported plan without starting a browser (exit 6)", async () => {
    const output = join(WORK, "run-unsupported");
    const { code, stdout } = await cli(["run", "--plan", `${CASES}/UNSUPPORTED-001/plan.json`, "--output", output]);
    expect(code).toBe(6);
    expect(stdout).toContain("UNSUPPORTED_ASSERTION (step 4)");
    expect(() => readdirSync(output)).toThrow();
  });

  it("reproduce aggregates isolated attempts", async () => {
    const output = join(WORK, "reproduce");
    const { code, stdout } = await cli(["reproduce", "--plan", `${CASES}/BUG-002/plan.json`, "--runs", "2", "--base-url", baseUrl, "--output", output]);
    expect(code).toBe(0);
    expect(stdout).toContain("Result: REPRODUCED");
    const reproduction = Reproduction.parse(JSON.parse(readFileSync(join(onlyDir(join(output, "reproductions")), "reproduction.json"), "utf8")));
    expect(reproduction.runs.map((r) => r.verdict)).toEqual(["failed", "failed"]);
    expect(reproduction.planProvenance.source).toBe("human");
  });

  it("validate checks targets against a preflight observation", async () => {
    const valid = await cli(["validate", "--plan", `${CASES}/BUG-001/plan.json`, "--base-url", baseUrl, "--output", join(WORK, "validate")]);
    expect(valid.code).toBe(0);
    expect(valid.stdout).toContain("Status: VALID");

    const bad = await cli(["validate", "--plan", `${CASES}/BAD-SELECTOR-001/plan.json`, "--base-url", baseUrl, "--output", join(WORK, "validate")]);
    expect(bad.code).toBe(5);
    expect(bad.stdout).toContain('TARGET_NOT_IN_REFERENCE (step 3): button "Add Wireless Mouse to basket" does not exist on the observed page');

    const weak = await cli(["validate", "--plan", `${CASES}/WEAK-ANCHOR-001/plan.json`, "--base-url", baseUrl, "--output", join(WORK, "validate")]);
    expect(weak.code).toBe(1);
    expect(weak.stdout).toContain("Status: WEAKLY_ANCHORED");
  });
});

describe("outcomes that are not bugs", () => {
  it("an unreachable environment is INCONCLUSIVE (exit 4), never a bug", async () => {
    const dead = `http://127.0.0.1:${await freePort()}/`;
    const { code, stdout } = await cli(["verify", "--plan", `${CASES}/BUG-001/plan.json`, "--runs", "2", "--base-url", dead, "--output", join(WORK, "dead")]);
    expect(code).toBe(4);
    expect(stdout).toContain("INCONCLUSIVE");
    expect(stdout).not.toContain("VERIFIED BUG");
  });

  it("a plan with model provenance keeps it in the report", async () => {
    const plan = JSON.parse(readFileSync(join(REPO, CASES, "HEALTHY-001/plan.json"), "utf8")) as Record<string, unknown>;
    const path = writePlan("model-plan.json", {
      ...plan,
      id: "MODEL-1",
      provenance: { source: "model", generator: "claude", model: "MODEL_NAME", version: "VERSION", promptVersion: "p0" },
    });
    const output = join(WORK, "model");
    const { code, stdout } = await cli(["verify", "--plan", path, "--runs", "3", "--base-url", baseUrl, "--output", output]);
    expect(code).toBe(1);
    expect(stdout).toContain("Provenance: model (claude, MODEL_NAME, VERSION)");
    const report = BugReport.parse(JSON.parse(readFileSync(join(onlyDir(join(output, "verifications")), "bug-report.json"), "utf8")));
    expect(report).toMatchObject({ outcome: "NOT_VERIFIED", provenance: { source: "model", model: "MODEL_NAME", promptVersion: "p0", createdAt: null } });
  });
});

describe("benchmark", () => {
  it(
    "buggy-shop: 3 bugs VERIFIED, every negative case stays negative",
    async () => {
      const output = join(WORK, "benchmark");
      const { code, stdout } = await cli(["benchmark", "--suite", "buggy-shop", "--runs", "3", "--output", output]);
      expect(code, stdout).toBe(0);
      expect(stdout).toContain("9/9 benchmark cases passed");
      const result = BenchmarkResult.parse(
        JSON.parse(readFileSync(join(onlyDir(join(output, "benchmarks")), "benchmark-result.json"), "utf8")),
      );
      expect(result.summary).toEqual({ total: 9, passed: 9, failed: 0, truePositives: 3, falseNegatives: 0, falsePositives: 0, trueNegatives: 6 });
      expect(Object.fromEntries(result.cases.map((c) => [c.id, c.actual.outcome]))).toEqual({
        "BUG-001": "VERIFIED",
        "BUG-002": "VERIFIED",
        "BUG-003": "VERIFIED",
        "HEALTHY-001": "NOT_VERIFIED",
        "BAD-SELECTOR-001": "INVALID_PLAN",
        "TIMEOUT-001": "INCONCLUSIVE",
        "UNSUPPORTED-001": "UNSUPPORTED",
        "WEAK-ANCHOR-001": "INCONCLUSIVE",
        "WRONG-PREMISE-001": "INCONCLUSIVE",
      });
      expect(result.cases.filter((c) => c.kind === "negative").every((c) => c.actual.outcome !== "VERIFIED")).toBe(true);
    },
    600_000,
  );

  it("fails a case whose outcome does not match, and reports why", async () => {
    const suiteDir = join(WORK, "wrong-suite");
    mkdirSync(join(suiteDir, "cases", "HEALTHY-AS-BUG"), { recursive: true });
    writeFileSync(join(suiteDir, "cases", "HEALTHY-AS-BUG", "plan.json"), readFileSync(join(REPO, CASES, "HEALTHY-001/plan.json")));
    writeFileSync(
      join(suiteDir, "cases", "HEALTHY-AS-BUG", "case.json"),
      JSON.stringify({
        schemaVersion: "exegezis.benchmark-case/v1",
        id: "HEALTHY-AS-BUG",
        kind: "positive",
        title: "A healthy behavior wrongly labelled as a bug",
        symptom: "Adding an item updates the badge.",
        expectedBug: null,
        plan: "plan.json",
        expected: { outcome: "VERIFIED", step: 4, value: "Cart (1)" },
      }),
    );
    writeFileSync(
      join(suiteDir, "suite.json"),
      JSON.stringify({
        schemaVersion: "exegezis.benchmark-suite/v1",
        id: "wrong-suite",
        description: "A suite whose only case is mislabelled.",
        app: { command: ["node", "src/server.ts"], cwd: SHOP, portEnv: "PORT", healthPath: "/api/health" },
        runs: 3,
        cases: ["cases/HEALTHY-AS-BUG"],
      }),
    );
    const { code, stdout } = await cli(["benchmark", "--suite", join(suiteDir, "suite.json"), "--base-url", baseUrl, "--output", join(WORK, "wrong")]);
    expect(code).toBe(1);
    expect(stdout).toContain("0/1 benchmark cases passed");
    expect(stdout).toContain("outcome NOT_VERIFIED, expected VERIFIED");
  });
});

describe("compile", () => {
  it.each(["BUG-001", "BUG-002", "BUG-003"])("%s compiles to the committed spec, byte for byte", async (bugId) => {
    const output = join(WORK, "compiled");
    const { code } = await cli(["compile", "--plan", `${CASES}/${bugId}/plan.json`, "--output", output]);
    expect(code).toBe(0);
    const generated = readFileSync(join(output, `${bugId}.spec.ts`), "utf8");
    const committed = readFileSync(join(REPO, CASES, bugId, `${bugId}.spec.ts`), "utf8").replaceAll("\r\n", "\n");
    expect(generated).toBe(committed);
  });
});
