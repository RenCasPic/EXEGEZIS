import { TestPlan, UNKNOWN_PROVENANCE, type AccessibilityNode } from "@exegezis/core";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import {
  AnthropicModelClient,
  buildUserMessage,
  createPlanGenerator,
  MockModelClient,
  ModelPlanGenerator,
  PlannerConfigurationError,
  PlannerOutput,
  planIdFor,
  PROMPT,
  redactText,
  renderAccessibilityTree,
  type ModelRequest,
  type PlanGenerationInput,
} from "../src/index.js";

const INPUT: PlanGenerationInput = {
  symptom: "After removing the only item from the cart, the cart badge still shows 1.",
  target: { kind: "web", baseUrl: "http://localhost:3000/" },
  capabilities: { actions: ["navigate", "click", "fill", "press", "wait", "screenshot"], assertions: ["text", "visibility", "existence", "http"] },
  observations: [
    { url: "http://localhost:3000/", accessibility: [{ role: "link", name: "Cart (0)" }, { role: "button", name: "Add Wireless Mouse to cart" }] },
  ],
};

/** An assert step in the model's wire format. */
const badge = (expected: string, purpose: "anchor" | "expectation", id: string) => ({
  type: "assert",
  id,
  purpose,
  description: `badge shows ${expected}`,
  assertion: { kind: "text", target: { by: "role", value: "link", name: "Cart" }, operator: "equals", expected },
});

/** The same step as a canonical TestPlan step. */
const canonicalBadge = (expected: string, purpose: "anchor" | "expectation", id: string) => ({
  type: "assert",
  id,
  purpose,
  description: `badge shows ${expected}`,
  assertion: { kind: "text", target: { role: "link", name: "Cart" }, operator: "equals", expected },
});

const VALID_ANSWER = {
  plan: {
    title: "Cart badge after removing the only item",
    description: "Add an item, remove it, check the badge.",
    preconditions: ["The shop is running"],
    steps: [
      { type: "navigate", value: "/" },
      badge("Cart (0)", "anchor", "initial"),
      { type: "click", target: { by: "role", value: "button", name: "Add Wireless Mouse to cart" } },
      badge("Cart (1)", "anchor", "after-add"),
      { type: "click", target: { by: "role", value: "button", name: "Remove Wireless Mouse" } },
      {
        type: "assert",
        id: "server-empty",
        purpose: "anchor",
        description: "The server says the cart is empty",
        assertion: { kind: "http", method: "DELETE", path: "/api/cart/items/mouse", expected: "/itemCount=0" },
      },
      { type: "wait", target: { by: "text", value: "Your cart is empty" }, value: "visible" },
      badge("Cart (0)", "expectation", "after-remove"),
    ],
  },
};

function mockGenerator(answer: unknown, extra: { stopReason?: "end" | "max_tokens" | "refusal" } = {}): { generator: ModelPlanGenerator; requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const text = typeof answer === "string" ? answer : JSON.stringify(answer);
  const generator = new ModelPlanGenerator(
    new MockModelClient((request) => {
      requests.push(request);
      return { text, ...(extra.stopReason === undefined ? {} : { stopReason: extra.stopReason }) };
    }),
  );
  return { generator, requests };
}

describe("ModelPlanGenerator", () => {
  it("turns a valid structured answer into a canonical TestPlan with model provenance", async () => {
    const { generator } = mockGenerator(VALID_ANSWER);
    const result = await generator.generate(INPUT);
    expect(result.status).toBe("generated");
    if (result.status !== "generated") return;
    // The plan is the existing contract, validated by the canonical schema.
    expect(TestPlan.parse(result.plan)).toEqual(result.plan);
    expect(result.plan).toMatchObject({
      id: planIdFor(INPUT.symptom),
      target: { kind: "web", baseUrl: "http://localhost:3000/" },
      provenance: { source: "model", generator: "mock", model: "mock-planner", promptVersion: "planner-v1", version: null },
    });
    // The wire format is translated into the canonical step shapes.
    expect(result.plan.steps[0]).toEqual({ type: "navigate", url: "/" });
    expect(result.plan.steps[2]).toEqual({ type: "click", target: { role: "button", name: "Add Wireless Mouse to cart" } });
    expect(result.plan.steps[5]).toMatchObject({
      assertion: { kind: "http", request: { method: "DELETE", path: "/api/cart/items/mouse" }, expected: { body: { pointer: "/itemCount", equals: 0 } } },
    });
    expect(result.plan.steps[6]).toEqual({
      type: "wait",
      condition: { kind: "element", target: { text: "Your cart is empty" }, state: "visible" },
    });
    expect(result.meta).toMatchObject({ provider: "mock", model: "mock-planner", promptVersion: PROMPT.version, usage: null });
  });

  it("is deterministic with the mock provider", async () => {
    const { generator } = mockGenerator(VALID_ANSWER);
    const a = await generator.generate(INPUT);
    const b = await generator.generate(INPUT);
    if (a.status !== "generated" || b.status !== "generated") throw new Error("expected plans");
    expect(a.plan.steps).toEqual(b.plan.steps);
    expect(a.plan.id).toBe(b.plan.id);
  });

  it("reports invalid JSON as INVALID_GENERATION, without repairing it", async () => {
    const { generator } = mockGenerator('{"plan": {"title": "x", ');
    expect(await generator.generate(INPUT)).toMatchObject({ status: "invalid_generation", kind: "invalid_json" });
  });

  it("reports answers that violate the schema", async () => {
    const eval_ = { ...VALID_ANSWER, plan: { ...VALID_ANSWER.plan, steps: [{ type: "eval", code: "alert(1)" }] } };
    expect(await mockGenerator(eval_).generator.generate(INPUT)).toMatchObject({ status: "invalid_generation", kind: "schema_violation" });

    // Passes the wire schema but not the canonical TestPlan (assertion id format).
    const badId = { ...VALID_ANSWER, plan: { ...VALID_ANSWER.plan, steps: [{ type: "navigate", value: "/" }, badge("Cart (0)", "expectation", "Not A Slug")] } };
    const result = await mockGenerator(badId).generator.generate(INPUT);
    expect(result).toMatchObject({ status: "invalid_generation", kind: "schema_violation" });
    if (result.status === "invalid_generation") expect(result.issues.join()).toMatch(/steps\.1\.id/);
  });

  it("rejects a malformed http expectation instead of guessing what was meant", async () => {
    const malformed = {
      plan: {
        ...VALID_ANSWER.plan,
        steps: [
          { type: "navigate", value: "/" },
          { type: "assert", id: "x", purpose: "expectation", description: "d", assertion: { kind: "http", method: "GET", path: "/api", expected: "it should be fine" } },
        ],
      },
    };
    expect(await mockGenerator(malformed).generator.generate(INPUT)).toMatchObject({ status: "invalid_generation", kind: "schema_violation" });
  });

  it("cannot carry a verdict: an answer that declares a bug is a schema violation", async () => {
    const smuggled = { ...VALID_ANSWER, verdict: "VERIFIED", bug: true, confidence: 0.99 };
    expect(await mockGenerator(smuggled).generator.generate(INPUT)).toMatchObject({ status: "invalid_generation", kind: "schema_violation" });
  });

  it("distinguishes an explicit decline from a missing plan", async () => {
    expect(await mockGenerator({ cannotPlanReason: "Too vague to test." }).generator.generate(INPUT)).toMatchObject({
      status: "declined",
      reason: "Too vague to test.",
      provenance: { source: "model" },
    });
    expect(await mockGenerator({}).generator.generate(INPUT)).toMatchObject({
      status: "invalid_generation",
      kind: "missing_plan",
    });
  });

  it("treats refusals and truncated answers as invalid generations", async () => {
    expect(await mockGenerator(VALID_ANSWER, { stopReason: "refusal" }).generator.generate(INPUT)).toMatchObject({ kind: "refused" });
    expect(await mockGenerator(VALID_ANSWER, { stopReason: "max_tokens" }).generator.generate(INPUT)).toMatchObject({ kind: "truncated" });
  });

  it("reports provider and configuration errors without inventing a plan", async () => {
    const failing = new ModelPlanGenerator(new MockModelClient(() => Promise.reject(new Error("503 overloaded"))));
    expect(await failing.generate(INPUT)).toEqual({ status: "error", kind: "provider", message: "503 overloaded" });
    const unconfigured = new ModelPlanGenerator(
      new MockModelClient(() => Promise.reject(new PlannerConfigurationError("no credentials"))),
    );
    expect(await unconfigured.generate(INPUT)).toMatchObject({ status: "error", kind: "configuration" });
  });

  it("makes exactly one model call per plan", async () => {
    const { generator, requests } = mockGenerator('{"broken"');
    await generator.generate(INPUT);
    expect(requests).toHaveLength(1);
  });
});

describe("prompt and input", () => {
  it("sends the versioned system prompt and a minimal user message", async () => {
    const { generator, requests } = mockGenerator(VALID_ANSWER);
    await generator.generate(INPUT);
    const [request] = requests;
    expect(request?.system).toBe(PROMPT.system);
    expect(request?.system).toMatch(/NOT to decide whether the application contains a bug/);
    expect(request?.user).toContain("Supported assertions: text, visibility, existence, http");
    expect(request?.user).toContain('- button "Add Wireless Mouse to cart"');
    expect(request?.user.endsWith(`Symptom to test:\n${INPUT.symptom}`)).toBe(true);
  });

  it("shows examples in the draft format (no fields the model may not write)", () => {
    const plan = TestPlan.parse({
      schemaVersion: "exegezis.test-plan/v1",
      id: "EX-1",
      title: "Example",
      target: { kind: "web", baseUrl: "http://localhost:3000/" },
      steps: [{ type: "navigate", url: "/" }, { ...canonicalBadge("Cart (0)", "expectation", "e"), timeoutMs: 2000 }],
    });
    const message = buildUserMessage({ ...INPUT, examples: [{ symptom: "Example symptom", plan }] });
    expect(message).toContain("Example 1 (same application, a different symptom)");
    expect(message).toContain("Example symptom");
    expect(message).not.toContain("timeoutMs");
    expect(message).not.toContain("provenance");
    expect(message).toContain('"by": "role"');
    // The example itself must be a valid answer.
    const json = message.slice(message.indexOf("Plan:\n") + 6, message.indexOf("\n\nSymptom to test"));
    expect(PlannerOutput.safeParse(JSON.parse(json)).success).toBe(true);
  });

  it("renders the accessibility tree compactly", () => {
    const tree: AccessibilityNode[] = [{ role: "list", children: [{ role: "listitem", children: [{ role: "text", text: "One" }, { role: "button", name: "Remove" }] }] }];
    expect(renderAccessibilityTree(tree)).toBe('- list\n  - listitem\n    - text: One\n    - button "Remove"');
  });
});

describe("redaction before anything leaves the machine", () => {
  it("redacts credentials and personal data from the symptom", async () => {
    const symptom =
      "Login fails. Authorization: Bearer abc.def.ghi, password=hunter2hunter2, key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV, " +
      "cookie: session=xyz123456 and my email is ana@example.com, see https://admin:s3cret@staging.test/x";
    const { generator, requests } = mockGenerator(VALID_ANSWER);
    const result = await generator.generate({ ...INPUT, symptom });
    const sent = requests[0]?.user ?? "";
    for (const secret of ["abc.def.ghi", "hunter2hunter2", "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV", "xyz123456", "ana@example.com", "s3cret"]) {
      expect(sent, secret).not.toContain(secret);
    }
    expect(sent).toContain("Login fails.");
    // Only the values are removed: the rest of the report survives.
    expect(sent).toContain("and my email is");
    expect(sent).toContain("staging.test/x");
    if (result.status === "generated") expect(result.meta.redactions).toBeGreaterThanOrEqual(5);
  });

  it("leaves ordinary text alone", () => {
    const text = "After removing the only item, the badge shows Cart (1) instead of Cart (0).";
    expect(redactText(text)).toEqual({ text, redactions: {} });
  });
});

describe("AnthropicModelClient", () => {
  it("fails with a configuration error when there are no credentials, before any network call", async () => {
    const saved = { key: process.env["ANTHROPIC_API_KEY"], token: process.env["ANTHROPIC_AUTH_TOKEN"], own: process.env["EXEGEZIS_ANTHROPIC_API_KEY"] };
    delete process.env["EXEGEZIS_ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_AUTH_TOKEN"];
    try {
      const result = await createPlanGenerator("anthropic").generate(INPUT);
      expect(result).toMatchObject({ status: "error", kind: "configuration" });
      if (result.status === "error") expect(result.message).toMatch(/EXEGEZIS_ANTHROPIC_API_KEY/);
    } finally {
      if (saved.key !== undefined) process.env["ANTHROPIC_API_KEY"] = saved.key;
      if (saved.token !== undefined) process.env["ANTHROPIC_AUTH_TOKEN"] = saved.token;
      if (saved.own !== undefined) process.env["EXEGEZIS_ANTHROPIC_API_KEY"] = saved.own;
    }
  });

  it("sends one structured-output request and maps the response and usage", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = new AnthropicModelClient({
      model: "claude-opus-5",
      client: {
        messages: {
          create: (params: Record<string, unknown>) => {
            calls.push(params);
            return Promise.resolve({
              model: "claude-opus-5",
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify(VALID_ANSWER) }],
              usage: { input_tokens: 1200, output_tokens: 340 },
            });
          },
        },
      } as never,
    });
    const result = await new ModelPlanGenerator(client).generate(INPUT);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "claude-opus-5", system: PROMPT.system, output_config: { format: { type: "json_schema" } } });
    expect(result).toMatchObject({
      status: "generated",
      provenance: { source: "model", generator: "anthropic", model: "claude-opus-5", promptVersion: "planner-v1" },
      meta: { usage: { inputTokens: 1200, outputTokens: 340 } },
    });
  });

  it("uses a JSON schema the structured-output API accepts (closed objects, no recursion)", () => {
    const schema = zodOutputFormat(PlannerOutput).schema as unknown;
    const problems: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (node === null || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record["type"] === "object" && record["additionalProperties"] !== false) problems.push(path);
      for (const key of ["minLength", "maxLength", "minimum", "maximum"]) if (key in record) problems.push(`${path}.${key}`);
      for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`);
    };
    walk(schema, "");
    expect(problems).toEqual([]);
  });
});

describe("provenance defaults", () => {
  it("never labels an unknown plan as human", () => {
    expect(UNKNOWN_PROVENANCE.source).toBe("unknown");
  });
});
