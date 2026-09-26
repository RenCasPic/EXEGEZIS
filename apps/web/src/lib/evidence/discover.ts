import { readdir } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { BenchmarkResult, InspectionReport, RootCauseSuiteResult } from "@exegezis/core";
import { benchmarksDir, displayPath, runsDir } from "../workspace";
import { readArtifact, type Loaded } from "./read";

/**
 * Discovery of what exists on disk. Nothing is registered anywhere: a
 * directory is an investigation because it holds a `bug-report.json` or a
 * `generation.json`, and a benchmark run because it holds a
 * `benchmark-result.json`. Ids are only ever resolved through this index,
 * so a URL can never point outside the discovered directories.
 */
export type InvestigationKind = "benchmark-case" | "verification" | "ai-verification" | "generated-plan";

export interface InvestigationRef {
  id: string;
  kind: InvestigationKind;
  dir: string;
  relDir: string;
  /** Committed results under benchmarks/<suite>/results: reports only, no evidence bundles. */
  archived: boolean;
  benchmarkId: string | null;
  caseId: string | null;
  /** Web job that produced it, when it was started from the UI. */
  jobId: string | null;
}

export interface BenchmarkRef {
  id: string;
  dir: string;
  relDir: string;
  archived: boolean;
  result: Loaded<BenchmarkResult>;
}

/** A run of `exegezis root-cause`: one report per case. */
export interface RootCauseRunRef {
  id: string;
  dir: string;
  relDir: string;
  archived: boolean;
  result: Loaded<RootCauseSuiteResult>;
}

/** One case of a root-cause run (`<run>/cases/<id>/root-cause-report.json`). */
export interface RootCauseRef {
  id: string;
  runId: string;
  caseId: string;
  dir: string;
  relDir: string;
  archived: boolean;
}

/** A run of `exegezis inspect` (`inspections/<id>/inspection-report.json`). */
export interface InspectionRef {
  id: string;
  dir: string;
  relDir: string;
  /** Web job that produced it, when it was started from the UI. */
  jobId: string | null;
  report: Loaded<InspectionReport>;
}

export interface WorkspaceIndex {
  investigations: InvestigationRef[];
  inspections: InspectionRef[];
  benchmarks: BenchmarkRef[];
  rootCauseRuns: RootCauseRunRef[];
  rootCauses: RootCauseRef[];
}

/** Evidence subdirectories: never investigations themselves. */
const SKIP = new Set(["attempts", "preflight", "compiled-test-results", "dom", "screenshots", "node_modules", "cases", "workspaces", "pages", "specs"]);
const MAX_DEPTH = 6;

async function listDir(dir: string): Promise<{ files: Set<string>; dirs: string[] }> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return {
      files: new Set(entries.filter((e) => e.isFile()).map((e) => e.name)),
      dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(),
    };
  } catch {
    return { files: new Set(), dirs: [] };
  }
}

function kindFromParent(dir: string): InvestigationKind {
  switch (basename(dirname(dir))) {
    case "verifications":
      return "verification";
    case "generated-plans":
      return "generated-plan";
    default:
      return "ai-verification";
  }
}

/** The web job whose output holds `dir` (runs/web/jobs/<id>/…), wherever runs/ is configured. */
function jobIdFor(dir: string): string | null {
  const rel = relative(runsDir(), dir).split("\\").join("/");
  const match = /^web\/jobs\/([0-9A-Z]{26})\//.exec(rel);
  return match?.[1] ?? null;
}

export async function discover(): Promise<WorkspaceIndex> {
  const investigations: InvestigationRef[] = [];
  const inspections: InspectionRef[] = [];
  const benchmarks: BenchmarkRef[] = [];
  const rootCauseRuns: RootCauseRunRef[] = [];
  const rootCauses: RootCauseRef[] = [];
  const used = new Set<string>();
  const uniqueId = (wanted: string): string => {
    let id = wanted;
    for (let n = 2; used.has(id); n++) id = `${wanted}~${n}`;
    used.add(id);
    return id;
  };

  async function addBenchmark(dir: string, archived: boolean, suiteDir: string | null): Promise<void> {
    const result = await readArtifact(join(dir, "benchmark-result.json"), BenchmarkResult);
    const id = uniqueId(archived && suiteDir !== null ? `${suiteDir}~${basename(dir)}` : basename(dir));
    benchmarks.push({ id, dir, relDir: displayPath(dir), archived, result });
    if (result.status !== "ok") return;
    for (const c of result.value.cases) {
      const caseDir = join(dir, "cases", c.id);
      investigations.push({
        id: uniqueId(`${id}~${c.id}`),
        kind: "benchmark-case",
        dir: caseDir,
        relDir: displayPath(caseDir),
        archived,
        benchmarkId: id,
        caseId: c.id,
        jobId: null,
      });
    }
  }

  async function addRootCauseRun(dir: string, archived: boolean, suiteDir: string | null): Promise<void> {
    const result = await readArtifact(join(dir, "root-cause-result.json"), RootCauseSuiteResult);
    const id = uniqueId(archived && suiteDir !== null ? `${suiteDir}~${basename(dir)}` : basename(dir));
    rootCauseRuns.push({ id, dir, relDir: displayPath(dir), archived, result });
    if (result.status !== "ok") return;
    for (const c of result.value.cases) {
      const caseDir = join(dir, "cases", c.id);
      rootCauses.push({ id: uniqueId(`${id}~${c.id}`), runId: id, caseId: c.id, dir: caseDir, relDir: displayPath(caseDir), archived });
    }
  }

  async function walk(dir: string, depth: number, archived: boolean, suiteDir: string | null): Promise<void> {
    const { files, dirs } = await listDir(dir);
    if (files.has("inspection-report.json")) {
      const relDir = displayPath(dir);
      const report = await readArtifact(join(dir, "inspection-report.json"), InspectionReport);
      inspections.push({ id: uniqueId(basename(dir)), dir, relDir, jobId: jobIdFor(dir), report });
      return;
    }
    if (files.has("root-cause-result.json")) {
      await addRootCauseRun(dir, archived, suiteDir);
      return;
    }
    if (files.has("benchmark-result.json")) {
      await addBenchmark(dir, archived, suiteDir);
      return;
    }
    if (files.has("bug-report.json") || files.has("generation.json")) {
      const relDir = displayPath(dir);
      investigations.push({
        id: uniqueId(basename(dir)),
        kind: kindFromParent(dir),
        dir,
        relDir,
        archived,
        benchmarkId: null,
        caseId: null,
        jobId: jobIdFor(dir),
      });
      return;
    }
    if (depth >= MAX_DEPTH) return;
    for (const name of dirs) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      await walk(join(dir, name), depth + 1, archived, suiteDir);
    }
  }

  await walk(runsDir(), 0, false, null);
  const suites = await listDir(benchmarksDir());
  for (const suite of suites.dirs) {
    await walk(join(benchmarksDir(), suite, "results"), 1, true, suite);
  }

  // Newest first: run directories start with a ULID, archived ones with a date.
  const newestFirst = (a: { relDir: string }, b: { relDir: string }) => (a.relDir < b.relDir ? 1 : a.relDir > b.relDir ? -1 : 0);
  investigations.sort(newestFirst);
  // Inspection directories are ULIDs, wherever they live (runs/inspections or a web job).
  inspections.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  benchmarks.sort(newestFirst);
  rootCauseRuns.sort(newestFirst);
  rootCauses.sort(newestFirst);
  return { investigations, inspections, benchmarks, rootCauseRuns, rootCauses };
}
