import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Where the UI reads from. Everything shown comes from files EXEGEZIS itself
 * wrote (`runs/`) or from results committed to the repository
 * (`benchmarks/<suite>/results/`). The UI never writes results of its own.
 */
export function repoRoot(): string {
  const configured = process.env.EXEGEZIS_ROOT;
  if (configured !== undefined && configured !== "") return resolve(configured);
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(join(dir, "packages", "core"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export function runsDir(): string {
  const configured = process.env.EXEGEZIS_RUNS_DIR;
  return configured !== undefined && configured !== "" ? resolve(configured) : join(repoRoot(), "runs");
}

export function benchmarksDir(): string {
  return join(repoRoot(), "benchmarks");
}

/** True when `child` is `parent` or lies inside it (after resolving `..`). */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Repository-relative, forward-slash path for display. */
export function displayPath(path: string): string {
  const root = repoRoot();
  const rel = isInside(root, path) ? relative(root, path) : path;
  return rel.split("\\").join("/");
}
