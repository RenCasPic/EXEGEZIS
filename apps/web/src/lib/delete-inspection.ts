import { rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { findInspection } from "./evidence/inspections";
import { jobsDir, readJob } from "./jobs";
import { currentWorkspace } from "./user-workspace";

/*
 * Deletes one of the signed-in user's inspections: its folder of artifacts
 * (report, screenshots, traces, DOM) and, when it was started from the app,
 * the whole web job that produced it (its log and progress). Only inside the
 * user's own runs folder; never one that is still running. The run's record
 * in the database stays: it counts for the month's plan usage.
 */

export type DeleteResult = "deleted" | "notFound" | "running";

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export async function deleteInspection(id: string): Promise<DeleteResult> {
  if (!/^[0-9A-Z]{26}$/.test(id)) return "notFound";
  const ws = await currentWorkspace();
  const ref = await findInspection(id);
  if (ref === null) return "notFound";
  if (ref.jobId !== null) {
    const job = await readJob(ref.jobId, ws);
    if (job !== null && (job.status === "running" || job.status === "queued")) return "running";
  }
  const target = ref.jobId === null ? ref.dir : join(jobsDir(ws.runs), ref.jobId);
  if (!inside(ws.runs, target)) return "notFound";
  await rm(target, { recursive: true, force: true });
  return "deleted";
}
