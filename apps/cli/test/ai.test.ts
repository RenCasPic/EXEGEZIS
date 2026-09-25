import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { BenchmarkResult, BugReport, TestPlan } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadExamples } from "../src/ai.js";
import { parseCliArgs } from "../src/args.js";
import { main } from "../src/main.js";

/**
 * The AI pipeline end to end, with the mock planner (recorded answers) so it
 * is deterministic: symptom → planner → TestPlan → the real verification
 * engine against the real buggy-shop.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHOP = join(REPO, "examples/buggy-shop");
const AI_CASES = join(REPO, "benchmarks/buggy-shop-ai/cases");
const WORK = join(REPO, "apps/cli/test/.tmp-ai");

let shop: ChildProcess;
let baseUrl: string;

async function freePort(): Promise<number> {
  return new Promise((resolvePort) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolvePort(typeof address === "object" && address !== null ? address.port : 0));
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

async function cli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const stderrStream = new PassThrough();
  stderrStream.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const code = await main(argv, { stdout: { write: (text: string) => (stdout += text) }, stderr: stderrStream, cwd: REPO });
  return { code, stdout, stderr };
}

const symptomOf = (id: string): string => (JSON.parse(readFileSync(join(AI_CASES, id, "case.json"), "utf8")) as { symptom: string }).symptom;
const mockOf = (id: string): string => join(AI_CASES, id, "mock-response.json");

function onlyDir(parent: string): string {
  const entries = readdirSync(parent);
  expect(entries).toHaveLength(1);
  return join(parent, entries[0] ?? "");
}

describe("generate-plan", () => {
  it("writes a validated TestPlan and does not execute it", async () => {
    const output = join(WORK, "generate");
    const { code, stdout } = await cli(["generate-plan", "--symptom", symptomOf("BUG-001"), "--base-url", baseUrl, "--planner", "mock", "--mock-response", mockOf("BUG-001"), "--output", output]);
    expect(code, stdout).toBe(0);
    expect(stdout).toContain("Generated TestPlan:\nPASS");
    expect(stdout).toContain("Semantic validation: VALID");
    expect(stdout).toContain("Provenance:    model / mock / mock-planner");
    expect(stdout).toContain("Prompt:        planner-v1");
    expect(stdout).toContain("The plan was not executed.");
    const dir = onlyDir(join(output, "generated-plans"));
    const plan = TestPlan.parse(JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")));
    expect(plan.provenance).toMatchObject({ source: "model", generator: "mock", model: "mock-planner", promptVersion: "planner-v1" });
    expect(existsSync(join(dir, "attempts"))).toBe(false);
  });
});

describe("ai-verify", () => {
  it("BUG-001: symptom → planner → TestPlan → VERIFIED by the engine, with model provenance in the report", async () => {
    const output = join(WORK, "ai-bug-001");
    const { code, stdout } = await cli(["ai-verify", "--symptom", symptomOf("BUG-001"), "--runs", "3", "--base-url", baseUrl, "--planner", "mock", "--mock-response", mockOf("BUG-001"), "--output", output]);
    expect(code, stdout).toBe(0);
    expect(stdout).toContain("EXEGEZIS AI VERIFY");
    expect(stdout).toContain("mock / mock-planner (prompt planner-v1");
    expect(stdout).toContain("3 / 3 failed (100%) — REPRODUCED");
    expect(stdout).toContain("VERIFIED BUG");
    const report = BugReport.parse(JSON.parse(readFileSync(join(onlyDir(join(output, "ai-verifications")), "bug-report.json"), "utf8")));
    expect(report).toMatchObject({
      outcome: "VERIFIED",
      provenance: { source: "model", generator: "mock", model: "mock-planner", promptVersion: "planner-v1" },
      expected: { value: "Cart (0)" },
      actual: { value: "Cart (1)" },
      compiledTest: { status: "failed" },
    });
  });

  it("an invented target → INVALID_PLAN, detected before execution (exit 5)", async () => {
    const output = join(WORK, "ai-invented");
    const { code, stdout } = await cli(["ai-verify", "--symptom", symptomOf("INVENTED-TARGET-001"), "--runs", "3", "--base-url", baseUrl, "--planner", "mock", "--mock-response", mockOf("INVENTED-TARGET-001"), "--output", output]);
    expect(code).toBe(5);
    expect(stdout).toContain('button "Add Wireless Mouse to wishlist" does not exist on the observed page');
    expect(stdout).toContain("INVALID PLAN");
    expect(existsSync(join(onlyDir(join(output, "ai-verifications")), "attempts"))).toBe(false);
  });

  it("a declined plan (ambiguous symptom) → INCONCLUSIVE, nothing executed (exit 4)", async () => {
    const { code, stdout } = await cli(["ai-verify", "--symptom", symptomOf("AMBIGUOUS-001"), "--base-url", baseUrl, "--planner", "mock", "--mock-response", mockOf("AMBIGUOUS-001"), "--output", join(WORK, "ai-ambiguous")]);
    expect(code).toBe(4);
    expect(stdout).toContain("DECLINED");
    expect(stdout).toContain("Verdict:\nINCONCLUSIVE");
  });

  it("malformed model output → INVALID_GENERATION, never repaired (exit 5)", async () => {
    const broken = join(WORK, "broken-answer.json");
    writeFileSync(broken, '{"plan": {"title": "Cart", "steps": [');
    const { code, stdout } = await cli(["ai-verify", "--symptom", "anything", "--base-url", baseUrl, "--planner", "mock", "--mock-response", broken, "--output", join(WORK, "ai-broken")]);
    expect(code).toBe(5);
    expect(stdout).toContain("INVALID_GENERATION (invalid_json)");
    expect(stdout).toContain("Verdict:\nINVALID_PLAN");
  });

  it("without credentials the real provider is a configuration error (exit 2), not a mystery", async () => {
    const saved = { key: process.env["ANTHROPIC_API_KEY"], token: process.env["ANTHROPIC_AUTH_TOKEN"], own: process.env["EXEGEZIS_ANTHROPIC_API_KEY"] };
    delete process.env["EXEGEZIS_ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_AUTH_TOKEN"];
    try {
      const { code, stdout } = await cli(["ai-verify", "--symptom", symptomOf("BUG-001"), "--base-url", baseUrl, "--output", join(WORK, "ai-nokey")]);
      expect(code).toBe(2);
      expect(stdout).toContain("CONFIGURATION ERROR: No Anthropic credentials");
    } finally {
      if (saved.key !== undefined) process.env["ANTHROPIC_API_KEY"] = saved.key;
      if (saved.token !== undefined) process.env["ANTHROPIC_AUTH_TOKEN"] = saved.token;
      if (saved.own !== undefined) process.env["EXEGEZIS_ANTHROPIC_API_KEY"] = saved.own;
    }
  });
});

describe("benchmark B (generated plans)", () => {
  it(
    "mock planner: bugs VERIFIED, negatives never VERIFIED, results separate from benchmark A",
    async () => {
      const output = join(WORK, "benchmark-b");
      const { code, stdout } = await cli(["benchmark", "--suite", "buggy-shop-ai", "--planner", "mock", "--runs", "3", "--output", output]);
      expect(code, stdout).toBe(0);
      expect(stdout).toContain("7/7 benchmark cases passed");
      const result = BenchmarkResult.parse(JSON.parse(readFileSync(join(onlyDir(join(output, "benchmarks")), "benchmark-result.json"), "utf8")));
      expect(result.planSource).toBe("generated");
      expect(result.planner).toMatchObject({ provider: "mock", model: "mock-planner", promptVersion: "planner-v1", examples: true });
      expect(result.summary).toMatchObject({ truePositives: 3, falsePositives: 0 });
      expect(result.metrics).toMatchObject({ falsePositiveRate: 0, verificationSuccess: 1, planValidityRate: 1, playwrightAgreement: 1 });
      expect(Object.fromEntries(result.cases.map((c) => [c.id, [c.generation?.status, c.actual.outcome]]))).toEqual({
        "BUG-001": ["generated", "VERIFIED"],
        "BUG-002": ["generated", "VERIFIED"],
        "BUG-003": ["generated", "VERIFIED"],
        "HEALTHY-001": ["generated", "NOT_VERIFIED"],
        "AMBIGUOUS-001": ["declined", "INCONCLUSIVE"],
        "INVENTED-TARGET-001": ["generated", "INVALID_PLAN"],
        "UNSUPPORTED-001": ["generated", "UNSUPPORTED"],
      });
      // Leave-one-out: each bug saw the other two bugs as examples, never its own.
      expect(result.cases.find((c) => c.id === "BUG-001")?.generation?.examples).toBe(2);
      expect(result.cases.find((c) => c.id === "HEALTHY-001")?.generation?.examples).toBe(3);
    },
    600_000,
  );

  it("refuses to run a generated suite without a planner, or a human suite with one", async () => {
    expect((await cli(["benchmark", "--suite", "buggy-shop-ai"])).stderr).toContain("choose a planner");
    expect((await cli(["benchmark", "--suite", "buggy-shop", "--planner", "mock"])).stderr).toContain("--planner does not apply");
  });
});

describe("examples never leak the answer", () => {
  it("excludes every example about the bug under evaluation", async () => {
    const dirs = ["BUG-001", "BUG-002", "BUG-003", "HEALTHY-001"].map((id) => join(REPO, "benchmarks/buggy-shop/cases", id));
    const forBug2 = await loadExamples(dirs, "BUG-002");
    expect(forBug2.map((e) => e.plan.id)).toEqual(["BUG-001", "BUG-003"]);
    // Negative cases are never examples (they have no reference answer to learn from).
    expect((await loadExamples(dirs, null)).map((e) => e.plan.id)).toEqual(["BUG-001", "BUG-002", "BUG-003"]);
  });
});

describe("AI command arguments", () => {
  it("parses generate-plan and ai-verify, defaulting to the anthropic planner and the lab URL", () => {
    expect(parseCliArgs(["generate-plan", "--symptom", "badge wrong"])).toMatchObject({
      kind: "generate-plan",
      symptom: "badge wrong",
      baseUrl: "http://localhost:3000/",
      planner: "anthropic",
    });
    expect(parseCliArgs(["ai-verify", "--symptom", "x", "--planner", "mock", "--mock-response", "a.json", "--runs", "5"])).toMatchObject({
      kind: "ai-verify",
      planner: "mock",
      mockResponse: "a.json",
      runs: 5,
    });
    expect(parseCliArgs(["benchmark", "--suite", "buggy-shop-ai", "--planner", "anthropic", "--no-examples"])).toMatchObject({ planner: "anthropic", examples: false });
  });

  it.each([
    [["ai-verify"], /Missing required option --symptom/],
    [["ai-verify", "--symptom", "  "], /Missing required option --symptom/],
    [["ai-verify", "--symptom", "x", "--planner", "gpt"], /--planner must be one of anthropic, mock/],
    [["ai-verify", "--symptom", "x", "--planner", "mock"], /--planner mock needs --mock-response/],
    [["generate-plan", "--symptom", "x", "--runs", "3"], /--runs is not valid for "generate-plan"/],
    [["verify", "--plan", "p.json", "--symptom", "x"], /--symptom is not valid for "verify"/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
  });
});
