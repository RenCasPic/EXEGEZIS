import { describe, expect, it } from "vitest";
import { matchesTarget, validatePlan, type AccessibilityNode, type PlanStep, type ReferencePage } from "../src/index.js";
import { badge, fakeAdapter, testPlan } from "./fake-adapter.js";

const descriptor = { ...fakeAdapter().descriptor, actions: ["navigate", "click", "fill", "press", "wait"] as const, assertions: ["text", "visibility", "existence", "count", "http"] as const };
const options = { descriptor: { actions: [...descriptor.actions], assertions: [...descriptor.assertions] }, mode: "verification" as const };

/** What the shop's home page exposes, as the preflight would observe it. */
const HOME: AccessibilityNode[] = [
  { role: "navigation", name: "Main", children: [{ role: "link", name: "Products" }, { role: "link", name: "Cart (0)" }] },
  { role: "heading", name: "Shopping Cart", level: 2 },
  { role: "button", name: "Add Wireless Mouse to cart" },
  { role: "paragraph", text: "Your cart is empty" },
  { role: "textbox", name: "Coupon code" },
];
const reference: ReferencePage[] = [{ url: "http://fake/", accessibility: HOME, latency: { navigationMs: 40, slowestResponseMs: 20 } }];

const nav: PlanStep = { type: "navigate", url: "/" };
const click = (name: string): PlanStep => ({ type: "click", target: { role: "button", name } });
const anchored = (...middle: PlanStep[]): PlanStep[] => [nav, badge("Cart (0)", "anchor", "initial"), click("Add Wireless Mouse to cart"), ...middle, badge("Cart (1)")];

describe("validatePlan", () => {
  it("accepts a strongly anchored plan whose initial targets exist", () => {
    const v = validatePlan(testPlan(anchored()), { ...options, reference });
    expect(v.status).toBe("valid");
    expect(v.issues).toEqual([]);
    // badge + click are checked; the final expectation comes after a state change.
    expect(v.reference).toEqual({ pages: ["http://fake/"], targetsChecked: 2, targetsUnchecked: 1 });
  });

  it("detects unsupported assertions and actions → unsupported", () => {
    const v = validatePlan(
      testPlan([nav, { type: "screenshot" }, { type: "assert", purpose: "expectation", assertion: { kind: "visual", baseline: "x" } }]),
      options,
    );
    expect(v.status).toBe("unsupported");
    expect(v.issues.map((i) => [i.code, i.stepIndex])).toEqual(
      expect.arrayContaining([
        ["UNSUPPORTED_ACTION", 2],
        ["UNSUPPORTED_ASSERTION", 3],
      ]),
    );
  });

  it("detects a target that does not exist on the observed page → invalid", () => {
    const v = validatePlan(testPlan([nav, badge("Cart (0)", "anchor", "a"), click("Add Wireless Mouse to basket"), badge("Cart (1)")]), {
      ...options,
      reference,
    });
    expect(v.status).toBe("invalid");
    expect(v.issues).toMatchObject([{ code: "TARGET_NOT_IN_REFERENCE", severity: "error", stepIndex: 3 }]);
  });

  it("does not judge targets after a state change (the reference no longer describes the page)", () => {
    const v = validatePlan(testPlan(anchored(click("Remove Wireless Mouse"))), { ...options, reference });
    expect(v.status).toBe("valid");
    expect(v.reference?.targetsUnchecked).toBe(2);
  });

  it("only warns when a property assertion's target is missing (hidden elements are not in the tree)", () => {
    const v = validatePlan(
      testPlan([nav, { type: "assert", purpose: "anchor", assertion: { kind: "text", target: { text: "Hidden note" }, operator: "equals", expected: "x" } }, click("Add Wireless Mouse to cart"), badge("Cart (1)")]),
      { ...options, reference },
    );
    expect(v.status).toBe("valid");
    expect(v.issues).toMatchObject([{ code: "TARGET_NOT_IN_REFERENCE", severity: "warning" }]);
  });

  it("flags expectations without anchor or without action → weakly anchored", () => {
    const v = validatePlan(testPlan([nav, badge("Cart (0)")]), options);
    expect(v.status).toBe("weakly_anchored");
    expect(v.issues.map((i) => i.code)).toEqual(["EXPECTATION_WITHOUT_ANCHOR", "EXPECTATION_WITHOUT_ACTION"]);
  });

  it("rejects plans that do not start by navigating, reuse ids or have no expectation", () => {
    expect(validatePlan(testPlan([click("Add Wireless Mouse to cart"), badge("Cart (1)")]), options).issues.map((i) => i.code)).toContain(
      "FIRST_STEP_NOT_NAVIGATE",
    );
    expect(validatePlan(testPlan([nav, badge("A", "anchor", "same"), click("Add Wireless Mouse to cart"), badge("B", "expectation", "same")]), options).issues.map((i) => i.code)).toContain(
      "DUPLICATE_STEP_ID",
    );
    const noExpectation = testPlan([nav, badge("A", "anchor", "a")]);
    expect(validatePlan(noExpectation, options)).toMatchObject({ status: "invalid" });
    // Just running it is fine: there is simply nothing to conclude.
    expect(validatePlan(noExpectation, { ...options, mode: "execution" }).status).toBe("valid");
  });

  it("warns when a timeout is below the latency observed by the preflight", () => {
    const slow: ReferencePage[] = [{ url: "http://fake/", accessibility: HOME, latency: { navigationMs: 20_000, slowestResponseMs: 1_500 } }];
    const v = validatePlan(testPlan(anchored(), "P", { timeouts: { assertionMs: 2_000 } }), { ...options, reference: slow });
    expect(v.status).toBe("valid");
    expect(v.issues.filter((i) => i.code === "TIMEOUT_BELOW_OBSERVED_LATENCY").length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const plan = testPlan([nav, badge("Cart (0)"), click("Nope")]);
    expect(validatePlan(plan, { ...options, reference })).toEqual(validatePlan(plan, { ...options, reference }));
  });
});

describe("matchesTarget", () => {
  it("follows Playwright's default matching: case-insensitive substring, exact on request", () => {
    expect(matchesTarget({ role: "link", name: "cart" }, HOME)).toBe(true);
    expect(matchesTarget({ role: "link", name: "Cart", exact: true }, HOME)).toBe(false);
    expect(matchesTarget({ role: "button", name: "Add Wireless Mouse" }, HOME)).toBe(true);
    expect(matchesTarget({ role: "link", name: "Checkout" }, HOME)).toBe(false);
    expect(matchesTarget({ text: "cart is empty" }, HOME)).toBe(true);
    expect(matchesTarget({ label: "Coupon code" }, HOME)).toBe(true);
    expect(matchesTarget({ label: "Shopping Cart" }, HOME)).toBe(false);
  });

  it("cannot check test ids or CSS against an accessibility tree", () => {
    expect(matchesTarget({ testId: "total" }, HOME)).toBeUndefined();
    expect(matchesTarget({ css: "#total" }, HOME)).toBeUndefined();
  });
});
