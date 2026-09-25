import { describe, expect, it } from "vitest";
import {
  Assertion,
  AssertStep,
  describeAssertion,
  matchesString,
  normalizeText,
  PlanStep,
  resolveJsonPointer,
  resolveNavigationUrl,
  TestPlan,
} from "../src/index.js";

describe("Assertion (assertions as data)", () => {
  it("accepts every kind, and defaults the operator to equals", () => {
    const assertions = [
      { kind: "text", target: { role: "status" }, expected: "Cart (0)" },
      { kind: "visibility", target: { text: "Order confirmed" }, expected: "visible" },
      { kind: "existence", target: { text: "Mechanical Keyboard ×" }, expected: "absent" },
      { kind: "attribute", target: { label: "Email" }, name: "type", expected: "email" },
      { kind: "url", operator: "contains", expected: "/cart" },
      { kind: "count", target: { role: "listitem" }, expected: 3 },
      { kind: "http", request: { method: "POST", path: "/api/cart/coupon" }, expected: { status: 200, body: { pointer: "/discountCents", equals: 1798 } } },
    ];
    for (const raw of assertions) {
      const parsed = Assertion.safeParse(raw);
      expect(parsed.success, JSON.stringify(raw)).toBe(true);
    }
    const text = Assertion.parse({ kind: "text", target: { role: "status" }, expected: "x" });
    expect(text).toMatchObject({ operator: "equals" });
  });

  it("round-trips through JSON unchanged", () => {
    const assertion = Assertion.parse({ kind: "http", request: { path: "/api/x" }, expected: { body: { pointer: "/a/0", equals: { b: [1, null] } } } });
    expect(Assertion.parse(JSON.parse(JSON.stringify(assertion)))).toEqual(assertion);
  });

  it("rejects invalid assertions", () => {
    const invalid = [
      { kind: "text", target: { role: "status" } }, // no expected
      { kind: "text", target: { role: "status" }, operator: "matches", expected: "([" }, // bad regex
      { kind: "visibility", target: { role: "status" }, expected: "shown" },
      { kind: "count", target: { role: "listitem" }, expected: -1 },
      { kind: "http", request: { path: "/api" }, expected: {} }, // nothing to check
      { kind: "http", request: { path: "api" }, expected: { status: 200 } }, // path must start with /
      { kind: "http", request: { path: "/api" }, expected: { body: { pointer: "discount", equals: 1 } } }, // not a JSON pointer
      { kind: "screenshot-diff", target: { role: "img" } }, // unknown kind
      { kind: "text", target: { role: "status" }, expected: "x", judge: "llm" }, // unknown field
    ];
    for (const raw of invalid) expect(Assertion.safeParse(raw).success, JSON.stringify(raw)).toBe(false);
  });

  it("wraps into an assert step with id, description and timeout", () => {
    const step = AssertStep.parse({
      type: "assert",
      id: "badge-after-remove",
      description: "Cart badge displays Cart (0)",
      timeoutMs: 2000,
      assertion: { kind: "text", target: { role: "link", name: "Cart" }, expected: "Cart (0)" },
    });
    expect(PlanStep.parse(step)).toEqual(step);
    expect(AssertStep.safeParse({ ...step, id: "Not A Slug" }).success).toBe(false);
  });

  it("describes itself in one line", () => {
    expect(describeAssertion(Assertion.parse({ kind: "text", target: { role: "link", name: "Cart" }, expected: "Cart (0)" }))).toBe(
      'text of link "Cart" equals "Cart (0)"',
    );
    expect(
      describeAssertion(Assertion.parse({ kind: "http", request: { method: "POST", path: "/api/c" }, expected: { status: 200, body: { pointer: "/d", equals: 1 } } })),
    ).toBe("response to POST /api/c has status 200 and body/d equals 1");
  });
});

describe("assertion helpers", () => {
  it("normalizes whitespace like Playwright text matching", () => {
    expect(normalizeText("  Cart\n  (0)​ ")).toBe("Cart (0)");
  });

  it("matches with each operator", () => {
    expect(matchesString("Cart (0)", "equals", "Cart (0)")).toBe(true);
    expect(matchesString("Cart (10)", "equals", "Cart (0)")).toBe(false);
    expect(matchesString("Total $80.91", "contains", "$80.91")).toBe(true);
    expect(matchesString("ORD-1001", "matches", "^ORD-\\d+$")).toBe(true);
  });

  it("resolves RFC 6901 JSON pointers", () => {
    const doc = { items: [{ "a/b": 1, "c~d": 2 }], zero: 0 };
    expect(resolveJsonPointer(doc, "")).toBe(doc);
    expect(resolveJsonPointer(doc, "/items/0/a~1b")).toBe(1);
    expect(resolveJsonPointer(doc, "/items/0/c~0d")).toBe(2);
    expect(resolveJsonPointer(doc, "/zero")).toBe(0);
    expect(resolveJsonPointer(doc, "/items/1")).toBeUndefined();
    expect(resolveJsonPointer(doc, "/items/01")).toBeUndefined();
    expect(resolveJsonPointer(doc, "/missing/x")).toBeUndefined();
  });
});

describe("TestPlan", () => {
  const plan = {
    schemaVersion: "exegezis.test-plan/v1",
    id: "BUG-001",
    title: "Cart badge",
    target: { kind: "web", baseUrl: "http://localhost:3000/" },
    steps: [
      { type: "navigate", url: "/" },
      { type: "assert", assertion: { kind: "visibility", target: { role: "button", name: "Add" }, expected: "visible" } },
      { type: "click", target: { role: "button", name: "Add" } },
      { type: "assert", assertion: { kind: "text", target: { role: "link", name: "Cart" }, expected: "Cart (1)" } },
      { type: "fill", target: { label: "Coupon code" }, value: "SAVE10" },
      { type: "assert", assertion: { kind: "count", target: { role: "listitem" }, expected: 1 } },
    ],
  };

  it("interleaves actions and assertions in one ordered sequence, with defaults", () => {
    const parsed = TestPlan.parse(plan);
    expect(parsed.steps.map((s) => s.type)).toEqual(["navigate", "assert", "click", "assert", "fill", "assert"]);
    expect(parsed.preconditions).toEqual([]);
    expect(parsed.metadata).toEqual({});
    expect(TestPlan.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("rejects invalid ids, empty plans and protocol-relative navigation", () => {
    expect(TestPlan.safeParse({ ...plan, id: "../BUG" }).success).toBe(false);
    expect(TestPlan.safeParse({ ...plan, steps: [] }).success).toBe(false);
    expect(TestPlan.safeParse({ ...plan, steps: [{ type: "navigate", url: "//evil.test/" }] }).success).toBe(false);
    expect(TestPlan.safeParse({ ...plan, target: { kind: "web", baseUrl: "localhost" } }).success).toBe(false);
  });

  it("resolves relative navigation against the base URL", () => {
    expect(resolveNavigationUrl("/cart", "http://localhost:3000/")).toBe("http://localhost:3000/cart");
    expect(resolveNavigationUrl("https://other.test/x", "http://localhost:3000/")).toBe("https://other.test/x");
  });
});
