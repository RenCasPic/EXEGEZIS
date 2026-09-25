import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readManifest, REDACTED, RunRecorder, sha256, Timeline } from "../src/index.js";

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

