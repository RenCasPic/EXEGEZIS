import { join } from "node:path";
import { userDirs } from "@exegezis/accounts";
import { cache } from "react";
import { cloud, isCloud, requireUser } from "./cloud";
import { repoRoot, runsDir } from "./workspace";

/**
 * Where this request's data lives.
 * - Local mode: runs/ (or EXEGEZIS_RUNS_DIR), the saved accesses and search
 *   settings in their usual places, and the benchmark results of the repository.
 * - Cloud mode: the signed-in user's own folders (EXEGEZIS_DATA_DIR/users/<id>/),
 *   and nothing else: no other user's runs, no repository results.
 */
export interface Workspace {
  /** Run artifacts: inspections, searches, investigations, web jobs. */
  runs: string;
  /** Saved site accesses (encrypted); null: the machine's default (local mode). */
  access: string | null;
  /** Search settings, saved searches and own templates; null: the machine's default (local mode). */
  search: string | null;
  /** The user (cloud mode), or null (local mode). */
  userId: string | null;
  /** Read benchmarks/<suite>/results (local mode only). */
  includeBenchmarks: boolean;
}

export function localWorkspace(): Workspace {
  return { runs: runsDir(), access: null, search: null, userId: null, includeBenchmarks: true };
}

export function dataDir(): string {
  return cloud().dataDir ?? join(repoRoot(), "data");
}

/** This request's workspace. In cloud mode it requires a signed-in user (otherwise, to /login). */
export const currentWorkspace = cache(async (): Promise<Workspace> => {
  if (!isCloud()) return localWorkspace();
  const user = await requireUser();
  const dirs = userDirs(dataDir(), user.id);
  return { runs: dirs.runs, access: dirs.access, search: dirs.search, userId: user.id, includeBenchmarks: false };
});

/** The variables a CLI started for this workspace needs, so it reads and writes the same folders. */
export function workspaceEnv(ws: Workspace): Record<string, string> {
  return {
    EXEGEZIS_RUNS_DIR: ws.runs,
    ...(ws.access === null ? {} : { EXEGEZIS_ACCESS_DIR: ws.access }),
    ...(ws.search === null ? {} : { EXEGEZIS_SEARCH_DIR: ws.search }),
  };
}

/** This workspace's search folder; undefined: the machine's default (local mode). */
export async function searchDir(): Promise<string | undefined> {
  return (await currentWorkspace()).search ?? undefined;
}
