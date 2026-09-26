import type { Tone } from "./evidence/stages";
import type { JobStatus } from "./jobs";

/** The status of an inspection job as the user reads it: the CLI's own outcome when there is one. */
export function inspectionJobState(status: JobStatus, exitCode: number | null, reportStatus: string | null): { label: string; tone: Tone } {
  if (status === "queued") return { label: "EN COLA", tone: "q" };
  if (status === "running") return { label: "EN CURSO", tone: "running" };
  if (status === "lost") return { label: "LOST", tone: "bad" };
  if (status === "failed") return { label: "ERROR", tone: "bad" };
  if (reportStatus === "BLOCKED" || reportStatus === "UNREACHABLE" || reportStatus === "TIMEOUT") return { label: reportStatus, tone: "warn" };
  if (reportStatus === null || (exitCode !== 0 && exitCode !== 1 && exitCode !== 4)) return { label: "ERROR", tone: "bad" };
  return { label: "TERMINADA", tone: "ok" };
}
