import { join } from "node:path";
import { userDirs } from "@exegezis/accounts";
import { cache } from "react";
import { config, requireUser } from "./auth";
import { repoRoot } from "./workspace";

/**
 * Where this request's data lives: the signed-in user's own folders
 * (EXEGEZIS_DATA_DIR/users/<id>/), and nothing else: no other user's runs.
 */
export interface Workspace {
  /** Run artifacts: inspections, searches, investigations, web jobs. */
  runs: string;
  /** Saved site accesses (encrypted). */
  access: string;
  /** Search settings, saved searches and own templates. */
  search: string;
  userId: string;
}

export function dataDir(): string {
  return config().dataDir ?? join(repoRoot(), "data");
}

/** This request's workspace: the signed-in user's (otherwise, to /login). */
export const currentWorkspace = cache(async (): Promise<Workspace> => {
  const user = await requireUser();
  const dirs = userDirs(dataDir(), user.id);
  return { runs: dirs.runs, access: dirs.access, search: dirs.search, userId: user.id };
});

/** The variables a CLI started for this workspace needs, so it reads and writes the same folders. */
export function workspaceEnv(ws: Workspace): Record<string, string> {
  return { EXEGEZIS_RUNS_DIR: ws.runs, EXEGEZIS_ACCESS_DIR: ws.access, EXEGEZIS_SEARCH_DIR: ws.search };
}

/** This user's search folder. */
export async function searchDir(): Promise<string> {
  return (await currentWorkspace()).search;
}
