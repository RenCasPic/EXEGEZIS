import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { hashTree, RootCauseInvestigation, RootCauseReport, RootCauseSuiteResult } from "@exegezis/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/args.js";
import { main } from "../src/main.js";

/**
 * Root cause by intervention, end to end, on the real buggy-shop: isolated
 * copies, a real mutation, real browser runs. Two runs per arm to keep it
 * fast; the benchmark uses five.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHOP = join(REPO, "examples/buggy-shop");
const CASE = join(REPO, "benchmarks/buggy-shop-root-cause/cases/BUG-002");
const WORK = join(REPO, "apps/cli/test/.tmp-rc");
const INCLUDE = ["package.json", "src", "public"];

async function cli(argv: string[]): Promise<{ code: number; stdout: string }> {
  let stdout = "";
  const stderr = new PassThrough();
  const code = await main(argv, { stdout: { write: (text: string) => (stdout += text) }, stderr, cwd: REPO });
  return { code, stdout };
}

/** A copy of the BUG-002 case with only H1 (true) and H2 (plausible, wrong), and no ground truth. */
function writeCase(): string {
  const investigation = RootCauseInvestigation.parse(JSON.parse(readFileSync(join(CASE, "investigation.json"), "utf8")));
  const dir = join(WORK, "suite", "cases", "BUG-002");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "investigation.json"),
    JSON.stringify({
      ...investigation,
      plan: resolve(CASE, investigation.plan),
      app: { ...investigation.app, dir: SHOP },
      policy: { runsPerArm: 2, minRefutedAlternatives: 1 },
      hypotheses: investigation.hypotheses.filter((h) => h.id === "H1" || h.id === "H2"),
    }),
  );
  writeFileSync(
    join(WORK, "suite", "suite.json"),
    JSON.stringify({ schemaVersion: "exegezis.root-cause-suite/v1", id: "rc-test", description: "test", cases: ["cases/BUG-002"] }),
  );
  return join(WORK, "suite", "suite.json");
}

let before: { files: number; hash: string };
let sourceBefore: string;
let result: { code: number; stdout: string };
let resultDir: string;

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  before = await hashTree(SHOP, INCLUDE);
  sourceBefore = readFileSync(join(SHOP, "src/shop.ts"), "utf8");
  result = await cli(["root-cause", "--suite", writeCase(), "--output", join(WORK, "out")]);
  const runs = join(WORK, "out", "root-cause");
  resultDir = join(runs, readdirSync(runs)[0] ?? "");
}, 300_000);

afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
});

describe("root-cause end to end (BUG-002)", () => {
  it("validates the true cause by intervention and refutes the plausible one", () => {
    expect(result.code, result.stdout).toBe(0);
    const report = RootCauseReport.parse(JSON.parse(readFileSync(join(resultDir, "cases/BUG-002/root-cause-report.json"), "utf8")));
    expect(report.baseline.counts).toEqual({ runs: 2, reproduced: 2, notReproduced: 0, invalid: 0 });
    const h1 = report.experiments.find((e) => e.hypothesisId === "H1");
    const h2 = report.experiments.find((e) => e.hypothesisId === "H2");
    expect(h1?.arm.counts.reproduced).toBe(0);
    expect(h1?.result.status).toBe("CONFIRMED");
    expect(h2?.arm.counts.reproduced).toBe(2);
    expect(h2?.result.status).toBe("FALSIFIED");
    expect(report.decision).toMatchObject({ status: "VALIDATED", hypothesisId: "H1" });
    expect(report.outcomes.find((o) => o.id === "H2")?.status).toBe("REFUTED");
  });

  it("keeps the artifacts of every arm and discards the mutated copies", () => {
    const caseDir = join(resultDir, "cases/BUG-002");
    expect(existsSync(join(caseDir, "baseline/reproduction.json"))).toBe(true);
    expect(readFileSync(join(caseDir, "experiments/H1/mutation.diff"), "utf8")).toContain("+  return items.reduce((sum, item) => sum + item.lineTotalCents, 0);");
    expect(existsSync(join(caseDir, "workspaces"))).toBe(true);
    expect(readdirSync(join(caseDir, "workspaces"))).toEqual([]);
    const suite = RootCauseSuiteResult.parse(JSON.parse(readFileSync(join(resultDir, "root-cause-result.json"), "utf8")));
    expect(suite.summary).toMatchObject({ cases: 1, validated: 1, falseValidations: 0 });
  });

  it("never modifies the working tree and works without the ground truth", async () => {
    expect((await hashTree(SHOP, INCLUDE)).hash).toBe(before.hash);
    expect(readFileSync(join(SHOP, "src/shop.ts"), "utf8")).toBe(sourceBefore);
    const report = RootCauseReport.parse(JSON.parse(readFileSync(join(resultDir, "cases/BUG-002/root-cause-report.json"), "utf8")));
    expect(report.isolation).toMatchObject({ unchanged: true, treeHashBefore: before.hash });
    expect(existsSync(join(resultDir, "cases/BUG-002/evaluation.json"))).toBe(false);
  });
});

describe("root-cause arguments", () => {
  it("defaults to the buggy-shop suite and accepts --case and --runs", () => {
    expect(parseCliArgs(["root-cause"])).toMatchObject({ kind: "root-cause", suite: "buggy-shop-root-cause" });
    expect(parseCliArgs(["root-cause", "--case", "BUG-001", "--runs", "3"])).toMatchObject({ caseIds: ["BUG-001"], runs: 3 });
  });
});
