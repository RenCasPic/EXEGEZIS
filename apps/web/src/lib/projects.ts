import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { BenchmarkSuite } from "@exegezis/core";
import { z } from "zod";
import { readArtifact, valueOf } from "./evidence/read";
import { benchmarksDir, displayPath, repoRoot } from "./workspace";

/**
 * Projects are the target applications present in the repository
 * (`examples/<name>`), with the benchmark suites that start them. There is no
 * project registry, repository connection or deployment configuration yet.
 */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  path: string;
  suites: { id: string; description: string; planSource: "human" | "generated"; cases: number; command: string }[];
}

const PackageJson = z.looseObject({ name: z.string().optional(), description: z.string().optional() });

export async function listProjects(): Promise<Project[]> {
  const examplesDir = join(repoRoot(), "examples");
  let names: string[];
  try {
    names = (await readdir(examplesDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    names = [];
  }
  const suites: { suite: BenchmarkSuite; appDir: string }[] = [];
  try {
    for (const entry of await readdir(benchmarksDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(benchmarksDir(), entry.name, "suite.json");
      const suite = valueOf(await readArtifact(file, BenchmarkSuite));
      if (suite !== null) suites.push({ suite, appDir: resolve(dirname(file), suite.app.cwd) });
    }
  } catch {
    // no benchmarks directory
  }
  return Promise.all(
    names.sort().map(async (name) => {
      const dir = join(examplesDir, name);
      const pkg = valueOf(await readArtifact(join(dir, "package.json"), PackageJson));
      return {
        id: name,
        name: pkg?.name ?? name,
        description: pkg?.description ?? null,
        path: displayPath(dir),
        suites: suites
          .filter((s) => basename(s.appDir) === name)
          .map(({ suite }) => ({
            id: suite.id,
            description: suite.description,
            planSource: suite.planSource,
            cases: suite.cases.length,
            command: suite.app.command.join(" "),
          })),
      };
    }),
  );
}

/** "Local" for loopback targets, otherwise the host. Derived from the target URL, nothing else. */
export function environmentOf(target: string | null): string | null {
  if (target === null) return null;
  try {
    const host = new URL(target).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" ? "Local" : host;
  } catch {
    return null;
  }
}
