import { describe, expect, it } from "vitest";
import {
  Action,
  ArtifactManifest,
  describeTarget,
  Evidence,
  Plan,
  redactAction,
  REDACTED,
  RelativePath,
  RunMetadata,
  TimelineEvent,
  ulid,
} from "../src/index.js";

describe("Action (actions as data)", () => {
  it("accepts the canonical click-by-role shape", () => {
    const action = Action.parse({ type: "click", target: { role: "button", name: "Checkout" } });
    expect(action).toEqual({ type: "click", target: { role: "button", name: "Checkout" } });
  });

  it("accepts every supported action type", () => {
    const actions = [
      { type: "navigate", url: "http://localhost:3000/cart" },
      { type: "click", target: { text: "Products" } },
      { type: "fill", target: { label: "Email" }, value: "a@b.c" },
      { type: "press", key: "Enter", target: { role: "textbox", name: "Coupon code" } },
      { type: "wait", condition: { kind: "timeout", ms: 100 } },
      { type: "wait", condition: { kind: "element", target: { testId: "total" }, state: "visible" } },
      { type: "wait", condition: { kind: "loadState", state: "networkidle" } },
      { type: "screenshot", name: "after-checkout", fullPage: true },
    ];
    for (const action of actions) expect(Action.safeParse(action).success, JSON.stringify(action)).toBe(true);
  });

  it("rejects unknown action types, unknown fields and ambiguous targets", () => {
    expect(Action.safeParse({ type: "eval", script: "alert(1)" }).success).toBe(false);
    expect(Action.safeParse({ type: "click", target: { role: "button" }, force: true }).success).toBe(false);
    // A target must use exactly one strategy.
    expect(Action.safeParse({ type: "click", target: { role: "button", css: "#x" } }).success).toBe(false);
    expect(Action.safeParse({ type: "navigate", url: "not a url" }).success).toBe(false);
    expect(Action.safeParse({ type: "screenshot", name: "../escape" }).success).toBe(false);
  });

  it("redacts sensitive fill values and nothing else", () => {
    const fill = { type: "fill", target: { label: "Password" }, value: "hunter22", sensitive: true } as const;
    expect(redactAction(fill).value).toBe(REDACTED);
    expect(redactAction({ ...fill, sensitive: false }).value).toBe("hunter22");
    expect(redactAction({ ...fill, sensitive: false }, true).value).toBe(REDACTED);
    const click = { type: "click", target: { role: "button", name: "Go" } } as const;
    expect(redactAction(click)).toBe(click);
  });

  it("describes targets compactly", () => {
    expect(describeTarget({ role: "button", name: "Checkout" })).toBe('button "Checkout"');
    expect(describeTarget({ label: "Email" })).toBe('label "Email"');
  });
});

describe("Plan", () => {
  it("round-trips through JSON serialization unchanged", () => {
    const plan = Plan.parse({
      schemaVersion: "exegezis.plan/v1",
      name: "checkout",
      steps: [
        { type: "navigate", url: "http://localhost:3000/" },
        { type: "click", target: { role: "button", name: "Add Keyboard to cart" } },
        { type: "observe", label: "after-add" },
      ],
    });
    expect(Plan.parse(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });

  it("requires at least one step and a known schema version", () => {
    expect(Plan.safeParse({ schemaVersion: "exegezis.plan/v1", steps: [] }).success).toBe(false);
    expect(Plan.safeParse({ schemaVersion: "v0", steps: [{ type: "observe" }] }).success).toBe(false);
  });
});

describe("TimelineEvent", () => {
  const base = { id: "evt-000001", seq: 1, timestamp: new Date().toISOString(), elapsedMs: 0, source: "runner" };

  it("validates the payload against the event type", () => {
    const ok = TimelineEvent.safeParse({
      ...base,
      type: "NETWORK_RESPONSE",
      payload: { evidenceId: "net-0001", status: 200, url: "http://x/api" },
    });
    expect(ok.success).toBe(true);
    const wrongPayload = TimelineEvent.safeParse({
      ...base,
      type: "NETWORK_RESPONSE",
      payload: { evidenceId: "net-0001", level: "error", text: "boom" },
    });
    expect(wrongPayload.success).toBe(false);
  });

  it("rejects free-text events", () => {
    expect(TimelineEvent.safeParse({ ...base, type: "SOMETHING_HAPPENED", payload: "text" }).success).toBe(false);
  });
});

describe("Evidence", () => {
  it("discriminates by kind and keeps unknown accessibility properties", () => {
    const evidence = Evidence.parse({
      kind: "accessibility_snapshot",
      id: "ax-0001",
      timestamp: new Date().toISOString(),
      pageUrl: "http://localhost:3000/",
      title: "Shop",
      format: "playwright-aria-json",
      nodeCount: 2,
      tree: [{ role: "link", name: "Products", url: "/products", children: [{ role: "text", text: "Products" }] }],
    });
    expect(evidence.kind).toBe("accessibility_snapshot");
    if (evidence.kind === "accessibility_snapshot") expect(evidence.tree[0]?.["url"]).toBe("/products");
  });
});

describe("RelativePath", () => {
  it("only allows forward-slash paths inside the run directory", () => {
    expect(RelativePath.safeParse("screenshots/0001.png").success).toBe(true);
    for (const bad of ["../x", "/etc/passwd", "C:/x", "a\\b", "a/../../b", ""]) {
      expect(RelativePath.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("RunMetadata and ArtifactManifest", () => {
  it("validate a minimal run", () => {
    const runId = ulid();
    expect(
      RunMetadata.safeParse({
        schemaVersion: "exegezis.run/v1",
        runId,
        command: "observe",
        status: "running",
        startedAt: new Date().toISOString(),
        target: { kind: "web", url: "http://localhost:3000" },
        config: {},
        configHash: "sha256:x",
        planHash: "sha256:y",
        collectors: {},
        redaction: { policy: "p", secretValuesTracked: 0 },
        manifest: "manifest.json",
      }).success,
    ).toBe(true);
    expect(
      ArtifactManifest.safeParse({
        schemaVersion: "exegezis.manifest/v1",
        runId,
        updatedAt: new Date().toISOString(),
        complete: false,
        artifacts: [],
        missing: [{ type: "trace", reason: "browser failed to start" }],
      }).success,
    ).toBe(true);
  });

  it("rejects a run id that is not a ULID", () => {
    const result = ArtifactManifest.safeParse({
      schemaVersion: "exegezis.manifest/v1",
      runId: "run-1",
      updatedAt: new Date().toISOString(),
      complete: true,
      artifacts: [],
      missing: [],
    });
    expect(result.success).toBe(false);
  });
});
