import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ulid } from "@exegezis/core";
import { z } from "zod";
import { readArtifact, readText } from "./evidence/read";
import { repoRoot, runsDir } from "./workspace";

/**
 * Investigations started from the UI. The UI does not verify anything
 * itself: it starts the real CLI (`exegezis ai-verify`) as a child process
 * and records only what it needs to follow it. The results are the CLI's
 * own artifacts, discovered like any other run.
 */
export const JobRecord = z.strictObject({
  schemaVersion: z.literal("exegezis.web-job/v1"),
  id: z.string().regex(/^[0-9A-Z]{26}$/),
  status: z.enum(["running", "finished", "failed"]),
  pid: z.int().nullable(),
  symptom: z.string(),
  baseUrl: z.string(),
  planner: z.literal("anthropic"),
  runs: z.int(),
  project: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  exitCode: z.int().nullable(),
  error: z.string().nullable(),
});
export type JobRecord = z.infer<typeof JobRecord>;

/** A job whose process is gone without reporting back (e.g. the UI server restarted). */
export type JobStatus = JobRecord["status"] | "lost";

/** Exit codes of the CLI (apps/cli/src/shared.ts). */
export const EXIT_MEANING: Record<number, string> = {
  0: "VERIFIED",
  1: "NOT VERIFIED or FLAKY",
  2: "usage or configuration error",
  3: "internal or provider error",
  4: "INCONCLUSIVE",
  5: "INVALID PLAN",
  6: "UNSUPPORTED",
};

export const jobsDir = (): string => join(runsDir(), "web", "jobs");
const jobDir = (id: string): string => join(jobsDir(), id);
export const jobOutputDir = (id: string): string => join(jobDir(id), "out");

async function writeJob(job: JobRecord): Promise<void> {
  await writeFile(join(jobDir(job.id), "job.json"), `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

function alive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readJob(id: string): Promise<{ job: JobRecord; status: JobStatus } | null> {
  if (!/^[0-9A-Z]{26}$/.test(id)) return null;
  const loaded = await readArtifact(join(jobDir(id), "job.json"), JobRecord);
  if (loaded.status !== "ok") return null;
  const job = loaded.value;
  const status: JobStatus = job.status === "running" && !alive(job.pid) ? "lost" : job.status;
  return { job, status };
}

export async function listJobs(): Promise<{ job: JobRecord; status: JobStatus }[]> {
  let names: string[];
  try {
    names = await readdir(jobsDir());
  } catch {
    return [];
  }
  const jobs = await Promise.all(names.sort().reverse().map((name) => readJob(name)));
  return jobs.filter((j) => j !== null);
}

export async function jobLog(id: string): Promise<string | null> {
  if (!/^[0-9A-Z]{26}$/.test(id)) return null;
  return readText(join(jobDir(id), "output.log"), 256 * 1024);
}

/** Whether the planner can authenticate. Checks presence only; the value is never read into the UI. */
export async function plannerCredentialsConfigured(): Promise<boolean> {
  for (const name of ["EXEGEZIS_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    if ((process.env[name] ?? "") !== "") return true;
  }
  const env = await readText(join(repoRoot(), ".env"), 64 * 1024);
  if (env === null) return false;
  return env
    .split(/\r?\n/)
    .some((line) => /^\s*(EXEGEZIS_ANTHROPIC_API_KEY|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN)\s*=\s*\S+/.test(line));
}

export function cliEntry(): string {
  return join(repoRoot(), "apps", "cli", "bin", "exegezis.js");
}

export interface StartJobInput {
  symptom: string;
  baseUrl: string;
  runs: number;
  project: string | null;
}

/** The exact command a job runs, for display and for reproducing it in a terminal. */
export function commandFor(input: StartJobInput, outputDir: string): string[] {
  return ["ai-verify", "--symptom", input.symptom, "--base-url", input.baseUrl, "--planner", "anthropic", "--runs", String(input.runs), "--output", outputDir];
}

export async function startJob(input: StartJobInput): Promise<JobRecord> {
  if (!existsSync(cliEntry())) throw new Error("The CLI is not built: run `pnpm build` first.");
  const id = ulid();
  await mkdir(jobDir(id), { recursive: true });
  const job: JobRecord = {
    schemaVersion: "exegezis.web-job/v1",
    id,
    status: "running",
    pid: null,
    symptom: input.symptom,
    baseUrl: input.baseUrl,
    planner: "anthropic",
    runs: input.runs,
    project: input.project,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
  };
  // Writes are serialized so a fast exit can never be overwritten by the initial record.
  let queue = writeJob(job);
  const update = (patch: Partial<JobRecord>): void => {
    Object.assign(job, patch);
    const snapshot = { ...job };
    queue = queue.then(() => writeJob(snapshot));
  };
  const log = openSync(join(jobDir(id), "output.log"), "a");
  try {
    // No shell: the symptom is passed as one argument, never interpreted.
    // cwd is the repository root so the CLI loads the same `.env` as in a terminal.
    const child = spawn(process.execPath, [cliEntry(), ...commandFor(input, jobOutputDir(id))], {
      cwd: repoRoot(),
      stdio: ["ignore", log, log],
      windowsHide: true,
    });
    child.on("error", (error) => update({ status: "failed", finishedAt: new Date().toISOString(), error: error.message }));
    child.on("exit", (code) => update({ status: "finished", finishedAt: new Date().toISOString(), exitCode: code }));
    if (job.status === "running") update({ pid: child.pid ?? null });
  } finally {
    closeSync(log);
  }
  await queue;
  return { ...job };
}
