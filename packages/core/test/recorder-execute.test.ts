import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  executeRun,
  Logger,
  MemorySink,
  readManifest,
  REDACTED,
  RunMetadata,
  RunRecorder,
  sha256,
  silentLogger,
  Timeline,
  type Action,
  type Adapter,
  type AdapterSession,
  type Observation,
  type Plan,
} from "../src/index.js";

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "exegezis-core-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("RunRecorder", () => {
  it("creates one directory per run and refuses to reuse it", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    expect(existsSync(recorder.dir)).toBe(true);
    await expect(RunRecorder.create({ outputDir, runId: recorder.runId })).rejects.toThrow(/EEXIST/);
  });

  it("appends events to the partial timeline immediately (crash-safe)", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    recorder.emit("PAGE_LOADED", "page", { url: "http://localhost/" });
    recorder.emit("PAGE_NAVIGATED", "page", { url: "http://localhost/cart" });
    const lines = readFileSync(join(recorder.dir, "timeline.partial.jsonl"), "utf8").trim().split("\n");
    expect(lines.map((l) => (JSON.parse(l) as { type: string }).type)).toEqual(["PAGE_LOADED", "PAGE_NAVIGATED"]);
  });

  it("keeps the manifest accurate after every artifact, before finalize", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    await recorder.writeJson("console", "console.json", { messages: [] });
    await recorder.flush();
    const manifest = readManifest(recorder.dir);
    expect(manifest.complete).toBe(false);
    expect(manifest.artifacts.map((a) => a.path)).toEqual(["console.json"]);
    const entry = manifest.artifacts[0];
    expect(entry?.sha256).toBe(sha256(readFileSync(join(recorder.dir, "console.json"))));
  });

  it("finalize writes a valid timeline, removes the partial log and scrubs late secrets", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    recorder.emit("CONSOLE_MESSAGE", "console", { evidenceId: "con-0001", level: "log", text: "token is tok-late-secret-1" });
    await recorder.writeJson("console", "console.json", { text: "token is tok-late-secret-1" });
    // The secret is only discovered later in the run (e.g. from a response header).
    recorder.secrets.add("tok-late-secret-1");
    const manifest = await recorder.finalize();

    expect(manifest.complete).toBe(true);
    expect(existsSync(join(recorder.dir, "timeline.partial.jsonl"))).toBe(false);
    const timeline = Timeline.parse(readJson(join(recorder.dir, "timeline.json")));
    expect(timeline.events).toHaveLength(1);

    for (const file of ["timeline.json", "console.json"]) {
      const text = readFileSync(join(recorder.dir, file), "utf8");
      expect(text, file).not.toContain("tok-late-secret-1");
      expect(text, file).toContain(REDACTED);
    }
    for (const entry of readManifest(recorder.dir).artifacts) {
      expect(entry.sha256, entry.path).toBe(sha256(readFileSync(join(recorder.dir, entry.path))));
      expect(entry.redaction).toBe("verified");
    }
  });

  it("rejects artifact paths that escape the run directory", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    await expect(recorder.writeJson("console", "../outside.json", {})).rejects.toThrow();
  });
});

/** Minimal in-memory adapter used to test the runner without a browser. */
function fakeAdapter(behavior: { failStart?: boolean; failOn?: Action["type"] } = {}): Adapter & { executed: Action[] } {
  const executed: Action[] = [];
  const adapter = {
    executed,
    descriptor: {
      id: "fake",
      version: "0.0.0",
      description: "test adapter",
      capabilities: ["console" as const],
      actions: ["navigate" as const, "click" as const, "fill" as const],
      produces: ["console" as const],
    },
    config: { mode: "test" },
    async start(context): Promise<AdapterSession> {
      if (behavior.failStart === true) throw new Error("cannot start");
      const { recorder } = context;
      return {
        environment: { adapter: { id: "fake", version: "0.0.0" } },
        async execute(action: Action) {
          executed.push(action);
          if (action.type === behavior.failOn) throw new Error(`${action.type} failed`);
        },
        async observe(request): Promise<Observation> {
          const observation: Observation = {
            kind: "browser_page",
            id: recorder.ids.next("obs"),
            timestamp: recorder.timestamp(),
            reason: request.reason,
            url: "http://fake/",
            title: "Fake",
            viewport: null,
            settled: true,
            evidence: {},
            gaps: [],
          };
          recorder.emit("OBSERVATION", "adapter", {
            observationId: observation.id,
            url: observation.url,
            title: observation.title,
            settled: true,
          });
          return observation;
        },
        async collectEvidence() {
          await recorder.writeJson("console", "console.json", { messages: [] });
          return { console: { status: "ok" as const } };
        },
        async close() {},
      };
    },
  } satisfies Adapter & { executed: Action[] };
  return adapter;
}

const target = { kind: "web" as const, url: "http://fake/" };

function plan(steps: Plan["steps"]): Plan {
  return { schemaVersion: "exegezis.plan/v1", steps };
}

describe("executeRun", () => {
  it("records a completed run with metadata, plan, timeline and manifest", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    const adapter = fakeAdapter();
    const outcome = await executeRun({
      adapter,
      recorder,
      target,
      logger: silentLogger,
      command: "observe",
      exegezisVersion: "0.1.0",
      plan: plan([{ type: "navigate", url: "http://fake/" }, { type: "observe" }]),
    });

    expect(outcome.status).toBe("completed");
    const metadata = RunMetadata.parse(readJson(join(outcome.dir, "metadata.json")));
    expect(metadata.status).toBe("completed");
    expect(metadata.finishedAt).toBeDefined();
    expect(metadata.configHash).toMatch(/^sha256:/);
    expect(metadata.environment?.runtime.version).toBe(process.version);
    expect(metadata.collectors).toEqual({ console: { status: "ok" } });

    const types = Timeline.parse(readJson(join(outcome.dir, "timeline.json"))).events.map((e) => e.type);
    expect(types).toEqual(["RUN_STARTED", "ACTION_STARTED", "ACTION_SUCCEEDED", "OBSERVATION", "RUN_FINISHED"]);

    const manifest = readManifest(outcome.dir);
    expect(manifest.complete).toBe(true);
    expect(manifest.missing).toEqual([]);
    expect(manifest.artifacts.map((a) => a.path).sort()).toEqual(
      ["console.json", "execution-errors.json", "metadata.json", "plan.json", "timeline.json"].sort(),
    );
  });

  it("produces the same config and plan hashes for the same inputs", async () => {
    const hashes = [];
    for (let i = 0; i < 2; i++) {
      const recorder = await RunRecorder.create({ outputDir });
      const outcome = await executeRun({
        adapter: fakeAdapter(),
        recorder,
        target,
        logger: silentLogger,
        command: "observe",
        exegezisVersion: "0.1.0",
        plan: plan([{ type: "navigate", url: "http://fake/" }]),
      });
      hashes.push([outcome.metadata.configHash, outcome.metadata.planHash]);
    }
    expect(hashes[0]).toEqual(hashes[1]);
  });

  it("stops at the first failed action but keeps and collects all evidence", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    const adapter = fakeAdapter({ failOn: "click" });
    const outcome = await executeRun({
      adapter,
      recorder,
      target,
      logger: silentLogger,
      command: "observe",
      exegezisVersion: "0.1.0",
      plan: plan([
        { type: "navigate", url: "http://fake/" },
        { type: "click", target: { role: "button", name: "Pay" } },
        { type: "navigate", url: "http://fake/never" },
      ]),
    });

    expect(outcome.status).toBe("failed");
    expect(adapter.executed.map((a) => a.type)).toEqual(["navigate", "click"]);
    expect(outcome.metadata.error).toMatchObject({ phase: "action", message: "click failed" });

    const events = Timeline.parse(readJson(join(outcome.dir, "timeline.json"))).events;
    expect(events.map((e) => e.type)).toEqual([
      "RUN_STARTED",
      "ACTION_STARTED",
      "ACTION_SUCCEEDED",
      "ACTION_STARTED",
      "EXECUTION_ERROR",
      "ACTION_FAILED",
      "OBSERVATION",
      "RUN_FINISHED",
    ]);
    // Evidence gathered before and after the failure is still there.
    expect(existsSync(join(outcome.dir, "console.json"))).toBe(true);
    const errors = readJson<{ phase: string; actionId: string }[]>(join(outcome.dir, "execution-errors.json"));
    expect(errors).toMatchObject([{ phase: "action", actionId: "act-0002" }]);
  });

  it("records a failed run when the adapter cannot start, listing missing artifacts", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    const outcome = await executeRun({
      adapter: fakeAdapter({ failStart: true }),
      recorder,
      target,
      logger: silentLogger,
      command: "observe",
      exegezisVersion: "0.1.0",
      plan: plan([{ type: "navigate", url: "http://fake/" }]),
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.metadata.error?.phase).toBe("start");
    const manifest = readManifest(outcome.dir);
    expect(manifest.complete).toBe(true);
    expect(manifest.missing).toEqual([{ type: "console", reason: "run failed during start: cannot start" }]);
    expect(existsSync(join(outcome.dir, "metadata.json"))).toBe(true);
  });

  it("rejects actions the adapter does not declare", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    const adapter = fakeAdapter();
    const outcome = await executeRun({
      adapter,
      recorder,
      target,
      logger: silentLogger,
      command: "observe",
      exegezisVersion: "0.1.0",
      plan: plan([{ type: "screenshot" }]),
    });
    expect(outcome.status).toBe("failed");
    expect(adapter.executed).toEqual([]);
    const types = Timeline.parse(readJson(join(outcome.dir, "timeline.json"))).events.map((e) => e.type);
    expect(types).toContain("ACTION_REJECTED");
  });

  it("never persists sensitive fill values", async () => {
    const recorder = await RunRecorder.create({ outputDir });
    const sink = new MemorySink();
    const outcome = await executeRun({
      adapter: fakeAdapter(),
      recorder,
      target,
      logger: new Logger([sink]),
      command: "observe",
      exegezisVersion: "0.1.0",
      plan: plan([{ type: "fill", target: { label: "Password" }, value: "correct-horse-battery", sensitive: true }]),
    });
    for (const entry of outcome.manifest.artifacts) {
      expect(readFileSync(join(outcome.dir, entry.path), "utf8"), entry.path).not.toContain("correct-horse-battery");
    }
    expect(JSON.stringify(sink.records)).not.toContain("correct-horse-battery");
    expect(sink.records.every((r) => r.runId === outcome.runId)).toBe(true);
  });
});
