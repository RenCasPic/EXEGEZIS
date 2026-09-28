import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SuggestedTerm, ulid } from "@exegezis/core";
import { z } from "zod";
import { getUiLocale } from "../i18n/server";
import { readArtifact, readText } from "./evidence/read";
import { displayPath, repoRoot, runsDir } from "./workspace";

/** The CLI has no build to run (pnpm build). Shown translated by the action that caught it. */
export class CliNotBuiltError extends Error {
  override readonly name = "CliNotBuiltError";
  constructor() {
    super("The CLI is not built: run `pnpm build` first.");
  }
}

/**
 * Work started from the UI. The UI never verifies or inspects anything itself:
 * it starts the real CLI (`exegezis ai-verify` or `exegezis inspect`) as a
 * child process — no shell, one argument per value — and records only what it
 * needs to follow it. Results are the CLI's own artifacts, discovered like any
 * other run.
 */
const JobBase = {
  schemaVersion: z.literal("exegezis.web-job/v1"),
  id: z.string().regex(/^[0-9A-Z]{26}$/),
  status: z.enum(["queued", "running", "finished", "failed"]),
  pid: z.int().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  exitCode: z.int().nullable(),
  error: z.string().nullable(),
  /** The UI server process that queued it: a queued job outlives no server restart. */
  serverPid: z.int().nullable().default(null),
  /** The language of the person who started it: the CLI's output and the AI's reasons use it (--lang). Older jobs: English. */
  lang: z.enum(["en", "es"]).default("en"),
};

export const AiVerifyJob = z.strictObject({
  ...JobBase,
  kind: z.literal("ai-verify"),
  symptom: z.string(),
  baseUrl: z.string(),
  planner: z.literal("anthropic"),
  runs: z.int(),
  project: z.string().nullable(),
});

export const InspectJob = z.strictObject({
  ...JobBase,
  kind: z.literal("inspect"),
  url: z.string(),
  runs: z.int(),
  maxPages: z.int().nullable(),
  maxDepth: z.int().nullable(),
  checks: z.array(z.string()).nullable(),
  /** Path of a Playwright storageState file on this machine; its content is never read by the UI. */
  storageState: z.string().nullable(),
  strictReadonly: z.boolean(),
  ignoreRobots: z.boolean(),
  /** Jobs from before the option existed ran with the default. */
  browserChannel: z.enum(["auto", "chromium", "chrome", "msedge"]).default("auto"),
  /** Inspect as an anonymous visitor, ignoring the saved access of the origin. */
  noSession: z.boolean().default(false),
});

/** `exegezis search` (docs/10-search.md): exact, by meaning or with a template. */
export const SearchJob = z.strictObject({
  ...JobBase,
  kind: z.literal("search"),
  url: z.string(),
  mode: z.enum(["exact", "meaning", "template"]),
  terms: z.string().nullable(),
  meaning: z.string().nullable(),
  template: z.string().nullable(),
  /** Template: also run its meaning part (uses the model). */
  withMeaning: z.boolean(),
  variants: z.boolean(),
  excludeScope: z.enum(["block", "page"]),
  suggested: z.array(SuggestedTerm),
  runs: z.int().nullable(),
  maxPages: z.int().nullable(),
  maxDepth: z.int().nullable(),
  includeHidden: z.boolean(),
  noSession: z.boolean(),
  ignoreRobots: z.boolean(),
  browserChannel: z.enum(["auto", "chromium", "chrome", "msedge"]),
  /** null: the limit in Settings. A higher value only when the person approved an estimate. */
  maxCostUsd: z.number().nullable(),
  /** Run this saved search. */
  saved: z.string().nullable(),
  /** Save the definition under this name before running it. */
  save: z.string().nullable(),
  /** Directory of an earlier search whose pages are reused (the site is not visited again). */
  reuse: z.string().nullable(),
});

/**
 * "Open a window to get access" (docs/09-access.md): `exegezis session login`
 * with a visible browser on this computer. The person presses "Listo" in the
 * UI (it creates the done file) or closes the window. Nothing secret is in
 * this record or in the job's log.
 */
export const AccessJob = z.strictObject({
  ...JobBase,
  kind: z.literal("access"),
  url: z.string(),
  browserChannel: z.enum(["auto", "chromium", "chrome", "msedge"]),
  /** The block this window is meant to solve (for the UI's wording). */
  block: z.string().nullable(),
  /** The inspection to start again with the same options once the access is saved. */
  relaunch: z.lazy(() => InspectRelaunch).nullable(),
  /** Set when relaunched: the new inspection job. */
  relaunchedJobId: z.string().nullable().default(null),
});

const InspectRelaunch = z.strictObject({
  url: z.string(),
  runs: z.int(),
  maxPages: z.int().nullable(),
  maxDepth: z.int().nullable(),
  checks: z.array(z.string()).nullable(),
  storageState: z.string().nullable(),
  strictReadonly: z.boolean(),
  ignoreRobots: z.boolean(),
  browserChannel: z.enum(["auto", "chromium", "chrome", "msedge"]),
  noSession: z.boolean(),
});

/** Jobs written before inspections existed have no `kind`: they are ai-verify jobs. */
export const JobRecord = z.preprocess(
  (value) => (value !== null && typeof value === "object" && !("kind" in value) ? { ...value, kind: "ai-verify" } : value),
  z.discriminatedUnion("kind", [AiVerifyJob, InspectJob, AccessJob, SearchJob]),
);
export type JobRecord = z.infer<typeof JobRecord>;
export type AiVerifyJob = z.infer<typeof AiVerifyJob>;
export type InspectJob = z.infer<typeof InspectJob>;
export type AccessJob = z.infer<typeof AccessJob>;
export type SearchJob = z.infer<typeof SearchJob>;

/** `lost`: the process (or the server that queued it) is gone without reporting back. */
export type JobStatus = JobRecord["status"] | "lost";

/** Exit codes of the CLI (apps/cli/src/args.ts). */
/** Exit codes the CLI documents (their meaning: jobs.exit.<code> in the catalogs). */
export const EXIT_CODES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

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
  let status: JobStatus = job.status;
  if (job.status === "running" && !alive(job.pid)) status = "lost";
  if (job.status === "queued" && job.serverPid !== process.pid) status = "lost";
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
  return env.split(/\r?\n/).some((line) => /^\s*(EXEGEZIS_ANTHROPIC_API_KEY|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN)\s*=\s*\S+/.test(line));
}

export function cliEntry(): string {
  return join(repoRoot(), "apps", "cli", "bin", "exegezis.js");
}

/** The language of the request that starts a job (English outside a request, e.g. in tests without one). */
async function jobLanguage(): Promise<"en" | "es"> {
  try {
    return await getUiLocale();
  } catch {
    return "en";
  }
}

/** The CLI arguments of a job: exactly what runs, also shown to reproduce it from a terminal. */
export function commandFor(job: JobRecord): string[] {
  return ["--lang", job.lang, ...commandArgs(job)];
}

function commandArgs(job: JobRecord): string[] {
  const output = jobOutputDir(job.id);
  if (job.kind === "access") {
    return ["session", "login", "--url", job.url, "--done-file", accessDoneFile(job.id), ...(job.browserChannel === "auto" ? [] : ["--browser-channel", job.browserChannel])];
  }
  if (job.kind === "search") {
    return [
      "search",
      "--url",
      job.url,
      ...(job.saved === null ? [] : ["--saved", job.saved]),
      ...(job.saved !== null ? [] : job.mode === "meaning" ? ["--meaning", job.meaning ?? ""] : job.mode === "template" ? ["--template", job.template ?? ""] : ["--terms", job.terms ?? ""]),
      ...(job.mode === "template" && job.withMeaning ? ["--with-meaning"] : []),
      ...(job.variants ? ["--variants"] : []),
      ...(job.excludeScope === "page" ? ["--exclude-scope", "page"] : []),
      ...(job.suggested.length === 0 ? [] : ["--suggested", JSON.stringify(job.suggested)]),
      ...(job.runs === null ? [] : ["--runs", String(job.runs)]),
      ...(job.maxPages === null ? [] : ["--max-pages", String(job.maxPages)]),
      ...(job.maxDepth === null ? [] : ["--max-depth", String(job.maxDepth)]),
      ...(job.includeHidden ? [] : ["--no-hidden"]),
      ...(job.noSession ? ["--no-session"] : []),
      ...(job.ignoreRobots ? ["--ignore-robots"] : []),
      ...(job.browserChannel === "auto" ? [] : ["--browser-channel", job.browserChannel]),
      ...(job.maxCostUsd === null ? [] : ["--max-cost", String(job.maxCostUsd)]),
      ...(job.save === null ? [] : ["--save", job.save]),
      ...(job.reuse === null ? [] : ["--reuse", job.reuse]),
      "--output",
      output,
    ];
  }
  if (job.kind === "ai-verify") {
    return ["ai-verify", "--symptom", job.symptom, "--base-url", job.baseUrl, "--planner", "anthropic", "--runs", String(job.runs), "--output", output];
  }
  return [
    "inspect",
    "--url",
    job.url,
    "--runs",
    String(job.runs),
    ...(job.maxPages === null ? [] : ["--max-pages", String(job.maxPages)]),
    ...(job.maxDepth === null ? [] : ["--max-depth", String(job.maxDepth)]),
    ...(job.checks === null ? [] : ["--checks", job.checks.join(",")]),
    ...(job.storageState === null ? [] : ["--storage-state", job.storageState]),
    ...(job.strictReadonly ? ["--strict-readonly"] : []),
    ...(job.ignoreRobots ? ["--ignore-robots"] : []),
    ...(job.browserChannel === "auto" ? [] : ["--browser-channel", job.browserChannel]),
    ...(job.noSession ? ["--no-session"] : []),
    "--output",
    output,
  ];
}

/** Terminal form of a job's command, with the output path shown relative to the repository. */
export function terminalCommand(job: JobRecord): string {
  const output = jobOutputDir(job.id);
  return ["pnpm exegezis", ...commandFor(job).map((a) => (a === output ? displayPath(output) : a)).map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a))].join(" ");
}

function spawnJob(job: JobRecord, onExit: () => void): void {
  // Writes are serialized so a fast exit can never be overwritten by an earlier record.
  let queue = writeJob(job);
  const update = (patch: Partial<JobRecord>): void => {
    Object.assign(job, patch);
    const snapshot = { ...job } as JobRecord;
    queue = queue.then(() => writeJob(snapshot));
  };
  const log = openSync(join(jobDir(job.id), "output.log"), "a");
  try {
    // No shell: every value is one argument, never interpreted. cwd is the
    // repository root so the CLI loads the same `.env` as in a terminal.
    const child = spawn(process.execPath, [cliEntry(), ...commandFor(job)], { cwd: repoRoot(), stdio: ["ignore", log, log], windowsHide: true });
    child.on("error", (error) => {
      update({ status: "failed", finishedAt: new Date().toISOString(), error: error.message });
      onExit();
    });
    child.on("exit", (code) => {
      update({ status: "finished", finishedAt: new Date().toISOString(), exitCode: code });
      onExit();
    });
    if (job.status === "running") update({ pid: child.pid ?? null });
  } finally {
    closeSync(log);
  }
}

function newJobBase(id: string, lang: "en" | "es") {
  return {
    lang,
    schemaVersion: "exegezis.web-job/v1" as const,
    id,
    pid: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    error: null,
    serverPid: process.pid,
  };
}

export interface StartJobInput {
  symptom: string;
  baseUrl: string;
  runs: number;
  project: string | null;
}

export async function startJob(input: StartJobInput): Promise<JobRecord> {
  if (!existsSync(cliEntry())) throw new CliNotBuiltError();
  const id = ulid();
  await mkdir(jobDir(id), { recursive: true });
  const job: JobRecord = { ...newJobBase(id, await jobLanguage()), status: "running", kind: "ai-verify", planner: "anthropic", ...input };
  spawnJob(job, () => undefined);
  await writeJob(job);
  return { ...job };
}

export interface StartInspectionInput {
  url: string;
  runs: number;
  maxPages: number | null;
  maxDepth: number | null;
  checks: string[] | null;
  storageState: string | null;
  strictReadonly: boolean;
  ignoreRobots: boolean;
  browserChannel: "auto" | "chromium" | "chrome" | "msedge";
  noSession: boolean;
}

/** One browser job (inspection or search) at a time: the others wait in a queue owned by this server process. */
const inspectionQueue: string[] = [];
let inspectionRunning: string | null = null;

async function runNextInspection(): Promise<void> {
  if (inspectionRunning !== null) return;
  const next = inspectionQueue.shift();
  if (next === undefined) return;
  const found = await readJob(next);
  if (found === null || (found.job.kind !== "inspect" && found.job.kind !== "search") || found.job.status !== "queued") return runNextInspection();
  const job: InspectJob | SearchJob = { ...found.job, status: "running", startedAt: new Date().toISOString() };
  inspectionRunning = job.id;
  spawnJob(job, () => {
    inspectionRunning = null;
    void runNextInspection();
  });
}

export async function startInspection(input: StartInspectionInput): Promise<JobRecord> {
  if (!existsSync(cliEntry())) throw new CliNotBuiltError();
  const id = ulid();
  await mkdir(jobDir(id), { recursive: true });
  const job: InspectJob = { ...newJobBase(id, await jobLanguage()), status: "queued", kind: "inspect", ...input };
  await writeJob(job);
  inspectionQueue.push(id);
  await runNextInspection();
  return (await readJob(id))?.job ?? job;
}

export type StartSearchInput = Omit<SearchJob, keyof typeof JobBase | "kind">;

export async function startSearch(input: StartSearchInput): Promise<JobRecord> {
  if (!existsSync(cliEntry())) throw new CliNotBuiltError();
  const id = ulid();
  await mkdir(jobDir(id), { recursive: true });
  const job: SearchJob = SearchJob.parse({ ...newJobBase(id, await jobLanguage()), status: "queued", kind: "search", ...input });
  await writeJob(job);
  inspectionQueue.push(id);
  await runNextInspection();
  return (await readJob(id))?.job ?? job;
}

/** The file the "Listo" button creates for an access job. */
export function accessDoneFile(id: string): string {
  return join(jobDir(id), "done");
}

/** The person finished in the window: the CLI saves the access (if the block is gone) and exits. */
export async function markAccessDone(id: string): Promise<boolean> {
  const found = await readJob(id);
  if (found === null || found.job.kind !== "access" || found.status !== "running") return false;
  await writeFile(accessDoneFile(id), `${new Date().toISOString()}\n`, "utf8");
  return true;
}

export interface StartAccessInput {
  url: string;
  browserChannel: "auto" | "chromium" | "chrome" | "msedge";
  block: string | null;
  relaunch: StartInspectionInput | null;
}

/** Opens the visible window (one at a time is enough: it is a person's task). */
export async function startAccessLogin(input: StartAccessInput): Promise<JobRecord> {
  if (!existsSync(cliEntry())) throw new CliNotBuiltError();
  const id = ulid();
  await mkdir(jobDir(id), { recursive: true });
  const job: AccessJob = { ...newJobBase(id, await jobLanguage()), status: "running", kind: "access", ...input, relaunchedJobId: null };
  spawnJob(job, () => {
    // Saved (exit 0) and an inspection to repeat: start it with the same options.
    if (job.exitCode === 0 && job.relaunch !== null) {
      void startInspection(job.relaunch).then(async (next) => {
        job.relaunchedJobId = next.id;
        await writeJob(job);
      });
    }
  });
  await writeJob(job);
  return { ...job };
}

/** Progress written by `exegezis inspect` (progress.json), for a running inspection job. */
export const InspectionProgressFile = z.looseObject({
  phase: z.string(),
  run: z.int(),
  runs: z.int(),
  pagesDone: z.int(),
  pagesPlanned: z.int(),
  current: z.string().nullable(),
  updatedAt: z.string(),
});
export type InspectionProgressFile = z.infer<typeof InspectionProgressFile>;

/** The inspection (or search) directory a job's CLI created, if any yet. */
export async function jobInspectionDir(id: string, kind: "inspections" | "searches" = "inspections"): Promise<string | null> {
  const base = join(jobOutputDir(id), kind);
  try {
    const names = (await readdir(base)).sort();
    const last = names.at(-1);
    return last === undefined ? null : join(base, last);
  } catch {
    return null;
  }
}

export async function jobProgress(id: string, kind: "inspections" | "searches" = "inspections"): Promise<InspectionProgressFile | null> {
  const dir = await jobInspectionDir(id, kind);
  if (dir === null) return null;
  const loaded = await readArtifact(join(dir, "progress.json"), InspectionProgressFile);
  return loaded.status === "ok" ? loaded.value : null;
}
