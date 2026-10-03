import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteInspection } from "../src/lib/delete-inspection";
import { buildReport, writeInspection } from "./inspection-fixture";

const previous = process.env.EXEGEZIS_RUNS_DIR;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "exegezis-delete-"));
  process.env.EXEGEZIS_RUNS_DIR = join(root, "runs");
});

afterEach(async () => {
  if (previous === undefined) delete process.env.EXEGEZIS_RUNS_DIR;
  else process.env.EXEGEZIS_RUNS_DIR = previous;
  await rm(root, { recursive: true, force: true });
});

function job(id: string, status: "running" | "finished", pid: number | null) {
  return JSON.stringify({ schemaVersion: "exegezis.web-job/v1", id, status, pid, startedAt: "2026-10-03T00:00:00.000Z", finishedAt: null, exitCode: null, error: null, kind: "inspect", url: "http://127.0.0.1:4300/", runs: 3, maxPages: null, maxDepth: null, checks: null, storageState: null, strictReadonly: false, ignoreRobots: false, browserChannel: "auto", noSession: false });
}

describe("deleting an inspection", () => {
  it("removes an inspection started from the CLI (its folder only)", async () => {
    const id = "01M3DEL0000000000000000001";
    const other = "01M3DEL0000000000000000002";
    await writeInspection(join(root, "runs", "inspections", id), buildReport(id));
    await writeInspection(join(root, "runs", "inspections", other), buildReport(other));
    expect(await deleteInspection(id)).toBe("deleted");
    expect(existsSync(join(root, "runs", "inspections", id))).toBe(false);
    expect(existsSync(join(root, "runs", "inspections", other))).toBe(true);
  });

  it("removes the whole web job of an inspection started from the app", async () => {
    const jobId = "01M3JOBDEL0000000000000001";
    const id = "01M3DEL0000000000000000003";
    const jobDir = join(root, "runs", "web", "jobs", jobId);
    await mkdir(jobDir, { recursive: true });
    await writeFile(join(jobDir, "job.json"), job(jobId, "finished", null));
    await writeFile(join(jobDir, "output.log"), "EXEGEZIS INSPECT\n");
    await writeInspection(join(jobDir, "out", "inspections", id), buildReport(id));
    expect(await deleteInspection(id)).toBe("deleted");
    expect(existsSync(jobDir)).toBe(false);
  });

  it("never deletes one that is still running, nor something that is not an inspection", async () => {
    const jobId = "01M3JOBDEL0000000000000002";
    const id = "01M3DEL0000000000000000004";
    const jobDir = join(root, "runs", "web", "jobs", jobId);
    await mkdir(jobDir, { recursive: true });
    await writeFile(join(jobDir, "job.json"), job(jobId, "running", process.pid));
    await writeInspection(join(jobDir, "out", "inspections", id), buildReport(id));
    expect(await deleteInspection(id)).toBe("running");
    expect(existsSync(jobDir)).toBe(true);
    expect(await deleteInspection("01M3NOPE000000000000000000")).toBe("notFound");
    expect(await deleteInspection("../../etc")).toBe("notFound");
  });
});
