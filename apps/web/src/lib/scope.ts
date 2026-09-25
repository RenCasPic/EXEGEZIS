import { cookies } from "next/headers";
import type { InvestigationSummary } from "./evidence/investigations";
import { environmentOf } from "./projects";

/** Project / environment filter chosen in the top bar. Stored in a cookie; purely a view filter. */
export interface Scope {
  project: string | null;
  environment: string | null;
}

export const SCOPE_COOKIE = "exegezis-scope";
export const UNASSIGNED = "__unassigned";

export async function getScope(): Promise<Scope> {
  const raw = (await cookies()).get(SCOPE_COOKIE)?.value;
  if (raw === undefined) return { project: null, environment: null };
  try {
    const parsed = JSON.parse(raw) as { project?: unknown; environment?: unknown };
    return {
      project: typeof parsed.project === "string" && parsed.project !== "" ? parsed.project : null,
      environment: typeof parsed.environment === "string" && parsed.environment !== "" ? parsed.environment : null,
    };
  } catch {
    return { project: null, environment: null };
  }
}

export function inScope(summary: InvestigationSummary, scope: Scope): boolean {
  if (scope.project !== null) {
    const project = summary.project ?? UNASSIGNED;
    if (project !== scope.project) return false;
  }
  if (scope.environment !== null && environmentOf(summary.target) !== scope.environment) return false;
  return true;
}
