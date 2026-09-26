/** URL of a file inside an investigation directory (served read-only by /api/artifacts). */
export function artifactUrl(investigationId: string, relPath: string, options: { source?: boolean; download?: boolean } = {}): string {
  const path = relPath
    .split(/[\\/]/)
    .filter((p) => p !== "")
    .map(encodeURIComponent)
    .join("/");
  return `/api/artifacts/${encodeURIComponent(investigationId)}/${path}${options.source === true ? "?source=1" : options.download === true ? "?download=1" : ""}`;
}

export const STAGE_ANCHOR: Record<string, string> = {
  symptom: "symptom",
  plan: "plan",
  reproduction: "reproduction",
  evidence: "evidence",
  investigation: "investigation",
  root_cause: "root-cause",
  fix: "fix",
  verification: "verification",
};
