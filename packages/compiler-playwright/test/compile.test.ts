import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TestPlan, type TestPlanInput } from "@exegezis/core";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileToPlaywright, locator, runCompiledSpec, UnsupportedStepError } from "../src/index.js";

/** Inside the repository, so `@playwright/test` resolves like in a customer project. */
const WORK_DIR = join(dirname(fileURLToPath(import.meta.url)), ".tmp");

const options = { exegezisVersion: "0.1.0", planHash: `sha256:${"a".repeat(64)}`, planPath: "plans/SHOP-1.json" };

function plan(steps: TestPlanInput["steps"], id = "SHOP-1", baseUrl = "http://localhost:3000/"): TestPlan {
  return TestPlan.parse({
    schemaVersion: "exegezis.test-plan/v1",
    id,
    title: "Counter increments",
    target: { kind: "web", baseUrl },
    preconditions: ["The app is running"],
    steps,
  });
}

const ALL_KINDS = plan([
  { type: "navigate", url: "/" },
  { type: "click", target: { role: "button", name: "Add" } },
  { type: "fill", target: { label: "Email" }, value: "ana@example.com" },
  { type: "press", key: "Enter", target: { placeholder: "Search" } },
  { type: "wait", condition: { kind: "element", target: { testId: "total" }, state: "visible" } },
  { type: "screenshot", name: "after-add" },
  { type: "observe", label: "after-add" },
  { type: "assert", assertion: { kind: "text", target: { role: "status" }, expected: "Count: 1" } },
  { type: "assert", assertion: { kind: "text", target: { text: "Total" }, operator: "contains", expected: "$1" } },
  { type: "assert", assertion: { kind: "text", target: { role: "status" }, operator: "matches", expected: "^Count: \\d+$" } },
  { type: "assert", assertion: { kind: "visibility", target: { css: "#panel" }, expected: "hidden" } },
  { type: "assert", assertion: { kind: "existence", target: { role: "alert" }, expected: "absent" } },
  { type: "assert", assertion: { kind: "attribute", target: { label: "Email" }, name: "type", expected: "email" } },
  { type: "assert", assertion: { kind: "url", expected: "/" } },
  { type: "assert", assertion: { kind: "count", target: { role: "listitem" }, expected: 2 } },
  { type: "assert", timeoutMs: 2000, assertion: { kind: "http", request: { method: "POST", path: "/api/count" }, expected: { status: 200, body: { pointer: "/count", equals: 1 } } } },
]);

describe("compileToPlaywright", () => {
  const spec = compileToPlaywright(ALL_KINDS, options);

  it("is deterministic: same plan, byte-identical output", () => {
    expect(compileToPlaywright(ALL_KINDS, options).source).toBe(spec.source);
    expect(spec.fileName).toBe("SHOP-1.spec.ts");
  });

  it("imports only @playwright/test and pins the runtime of the EXEGEZIS run", () => {
    const imports = spec.source.split("\n").filter((l) => l.startsWith("import "));
    expect(imports).toEqual(['import { expect, test, type Response } from "@playwright/test";']);
    expect(spec.source).not.toContain('from "@exegezis');
    expect(spec.source).toContain('baseURL: process.env["BASE_URL"] ?? "http://localhost:3000/",');
    expect(spec.source).toContain('locale: "en-US",');
    expect(spec.source).toContain('timezoneId: "UTC",');
    expect(spec.source).toContain("//   - The app is running");
  });

  it("emits idiomatic Playwright locators, semantic first", () => {
    expect(locator({ role: "button", name: "Add to cart" })).toBe('page.getByRole("button", { name: "Add to cart" })');
    expect(locator({ role: "link", name: "Cart", exact: true })).toBe('page.getByRole("link", { name: "Cart", exact: true })');
    expect(locator({ role: "status" })).toBe('page.getByRole("status")');
    expect(locator({ label: "Email" })).toBe('page.getByLabel("Email")');
    expect(locator({ text: "Your cart is empty", exact: false })).toBe('page.getByText("Your cart is empty", { exact: false })');
    expect(locator({ placeholder: "Search" })).toBe('page.getByPlaceholder("Search")');
    expect(locator({ testId: "total" })).toBe('page.getByTestId("total")');
    expect(locator({ css: "#panel" })).toBe('page.locator("#panel")');
    expect(locator({ text: 'He said "hi"\n' })).toBe('page.getByText("He said \\"hi\\"\\n")');
  });

  it("emits one web-first assertion per kind, with the plan's timeout", () => {
    const expected = [
      'await expect(page.getByRole("status")).toHaveText("Count: 1", { timeout: 5000 });',
      'await expect(page.getByText("Total")).toContainText("$1", { timeout: 5000 });',
      'await expect(page.getByRole("status")).toHaveText(new RegExp("^Count: \\\\d+$"), { timeout: 5000 });',
      'await expect(page.locator("#panel")).toBeHidden({ timeout: 5000 });',
      'await expect(page.getByRole("alert")).toHaveCount(0, { timeout: 5000 });',
      'await expect(page.getByLabel("Email")).toHaveAttribute("type", "email", { timeout: 5000 });',
      'await expect(page).toHaveURL(new URL("/", baseURL).toString(), { timeout: 5000 });',
      'await expect(page.getByRole("listitem")).toHaveCount(2, { timeout: 5000 });',
      'await expect.poll(() => lastResponse(responses, "POST", "/api/count")?.status(), { timeout: 2000 }).toBe(200);',
      '.poll(async () => jsonPointer(await lastResponse(responses, "POST", "/api/count")?.json(), "/count"), { timeout: 2000 })',
    ];
    for (const line of expected) expect(spec.source, line).toContain(line);
    expect(spec.source).toContain("async ({ page, baseURL }) =>");
  });

  it("wraps each plan step in a numbered test.step and maps its source lines", () => {
    const lines = spec.source.split("\n");
    expect(spec.steps).toHaveLength(ALL_KINDS.steps.length);
    for (const step of spec.steps) {
      expect(lines[step.startLine - 1]).toContain(`await test.step("${step.stepIndex}. `);
      expect(lines[step.endLine - 1]?.trim()).toBe("});");
    }
  });

  it("takes every timeout from the plan's timeout policy", () => {
    const tuned = compileToPlaywright(
      plan([{ type: "navigate", url: "/" }, { type: "assert", purpose: "expectation", assertion: { kind: "count", target: { role: "listitem" }, expected: 1 } }]),
      options,
    ).source;
    expect(tuned).toContain("  actionTimeout: 10000,");
    expect(tuned).toContain("  navigationTimeout: 30000,");
    expect(tuned).toContain("  test.setTimeout(120000);");
    expect(tuned).toContain("toHaveCount(1, { timeout: 5000 })");

    const custom = TestPlan.parse({
      ...plan([{ type: "navigate", url: "/" }, { type: "assert", purpose: "expectation", assertion: { kind: "count", target: { role: "listitem" }, expected: 1 } }]),
      timeouts: { actionMs: 1111, navigationMs: 2222, assertionMs: 3333, runMs: 4444 },
    });
    const source = compileToPlaywright(custom, options).source;
    for (const line of ["  actionTimeout: 1111,", "  navigationTimeout: 2222,", "  test.setTimeout(4444);", "toHaveCount(1, { timeout: 3333 })"]) {
      expect(source, line).toContain(line);
    }
  });

  it("refuses to compile unsupported steps instead of silently dropping them", () => {
    const visual = plan([{ type: "navigate", url: "/" }, { type: "assert", purpose: "expectation", assertion: { kind: "visual", baseline: "home" } }]);
    expect(() => compileToPlaywright(visual, options)).toThrow(UnsupportedStepError);
    expect(() => compileToPlaywright(visual, options)).toThrow(/step 2 uses unsupported "visual"/);
  });

  it("never writes sensitive values into the spec", () => {
    const secret = compileToPlaywright(
      plan([
        { type: "fill", target: { label: "Password" }, value: "hunter2hunter2" },
        { type: "fill", target: { label: "API token" }, value: "tok-123456789", sensitive: true },
      ]),
      options,
    ).source;
    expect(secret).not.toContain("hunter2hunter2");
    expect(secret).not.toContain("tok-123456789");
    expect(secret).toContain('process.env["EXEGEZIS_SECRET_STEP_1"]');
    expect(secret).toContain('process.env["EXEGEZIS_SECRET_STEP_2"]');
  });

  it("produces TypeScript that type-checks against @playwright/test", () => {
    mkdirSync(WORK_DIR, { recursive: true });
    const file = join(WORK_DIR, "typecheck.spec.ts");
    writeFileSync(file, spec.source);
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2023,
      lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ["node"],
      skipLibCheck: true,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(diagnostics).toEqual([]);
  });
});

describe("runCompiledSpec (the standard Playwright runner)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    let count = 0;
    server = createServer((req, res) => {
      if (req.url === "/api/count" && req.method === "POST") {
        count += 1;
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ count: count }));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Counter</title>
        <p role="status">Count: 0</p><button>Add</button>
        <script>
          document.querySelector("button").onclick = async () => {
            const { count } = await (await fetch("/api/count", { method: "POST" })).json();
            document.querySelector("[role=status]").textContent = "Count: " + (count > 1 ? count + 1 : count);
          };
        </script>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    mkdirSync(WORK_DIR, { recursive: true });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(WORK_DIR, { recursive: true, force: true });
  });

  async function execute(steps: TestPlanInput["steps"], id: string) {
    const spec = compileToPlaywright(plan(steps, id, "http://localhost:1/"), options);
    const specPath = join(WORK_DIR, spec.fileName);
    writeFileSync(specPath, spec.source);
    // BASE_URL points the spec at the fixture: the plan's own base URL is unreachable.
    return runCompiledSpec({ specPath, steps: spec.steps, baseUrl, outputDir: join(WORK_DIR, `${id}-results`) });
  }

  const add = { type: "click", target: { role: "button", name: "Add" } } as const;

  it("passes when the application meets every expectation", async () => {
    const result = await execute(
      [
        { type: "navigate", url: "/" },
        add,
        { type: "assert", assertion: { kind: "text", target: { role: "status" }, expected: "Count: 1" } },
        { type: "assert", assertion: { kind: "http", request: { method: "POST", path: "/api/count" }, expected: { status: 200 } } },
      ],
      "PASSING",
    );
    expect(result).toMatchObject({ status: "passed", exitCode: 0, runner: "@playwright/test 1.63.0" });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it("fails at the step whose expectation the application violates", async () => {
    const result = await execute(
      [
        { type: "navigate", url: "/" },
        add,
        add,
        // The fixture has a bug: after the second click it shows 3, not 2.
        { type: "assert", timeoutMs: 1000, assertion: { kind: "text", target: { role: "status" }, expected: "Count: 2" } },
      ],
      "FAILING",
    );
    expect(result).toMatchObject({ status: "failed", failedAtStep: 4, exitCode: 1 });
    expect(result.message).toMatch(/toHaveText/);
  }, 120_000);

  it("reports an error when @playwright/test is not resolvable from the spec's location", async () => {
    const outside = join(tmpdir(), `exegezis-compile-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    const spec = compileToPlaywright(plan([{ type: "navigate", url: "/" }]), options);
    const specPath = join(outside, spec.fileName);
    writeFileSync(specPath, spec.source);
    try {
      const result = await runCompiledSpec({ specPath, steps: spec.steps, outputDir: join(outside, "out") });
      expect(result).toMatchObject({ status: "error", exitCode: null });
      expect(result.message).toMatch(/not resolvable/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
