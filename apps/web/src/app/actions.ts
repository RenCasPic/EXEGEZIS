"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isLoopbackHost } from "@/lib/inspect-checks";
import { probeTarget } from "@/lib/probe";
import { parseInspectForm } from "@/lib/inspect-options";
import { plannerCredentialsConfigured, startInspection, startJob } from "@/lib/jobs";
import { SCOPE_COOKIE } from "@/lib/scope";

export async function setScope(project: string | null, environment: string | null): Promise<void> {
  (await cookies()).set(SCOPE_COOKIE, JSON.stringify({ project, environment }), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });
}

const StartInput = z.strictObject({
  symptom: z.string().trim().min(12, "Describe the symptom in at least a sentence.").max(3000),
  expected: z.string().trim().max(1000),
  actual: z.string().trim().max(1000),
  baseUrl: z
    .url({ protocol: /^https?$/, error: "Use an http(s) target URL." })
    .transform((u) => (u.endsWith("/") ? u : `${u}/`)),
  runs: z.coerce.number().int().min(2).max(20),
  project: z.string().max(100),
});

export interface StartState {
  error: string | null;
  fields?: Record<string, string>;
}

/**
 * Starts a real `exegezis ai-verify` run. The expected/actual notes are
 * appended to the symptom text, because the symptom is the only thing the
 * planner receives.
 */
export async function startInvestigation(_prev: StartState, form: FormData): Promise<StartState> {
  const field = (name: string, fallback = ""): string => {
    const value = form.get(name);
    return typeof value === "string" ? value : fallback;
  };
  const raw = {
    symptom: field("symptom"),
    expected: field("expected"),
    actual: field("actual"),
    baseUrl: field("baseUrl"),
    runs: field("runs", "5"),
    project: field("project"),
  };
  const parsed = StartInput.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join(" "), fields: raw };
  if (!(await plannerCredentialsConfigured())) {
    return { error: "No planner credentials: set EXEGEZIS_ANTHROPIC_API_KEY in the repository's .env file.", fields: raw };
  }
  const { symptom, expected, actual, baseUrl, runs, project } = parsed.data;
  // The planner call costs money and time: never spend it on a target that is not up.
  const reachable = await probeTarget(baseUrl);
  if (reachable !== null) return { error: reachable, fields: raw };
  const text = [symptom, expected === "" ? null : `Expected: ${expected}`, actual === "" ? null : `Actual: ${actual}`].filter((l) => l !== null).join("\n");
  let jobId: string;
  try {
    jobId = (await startJob({ symptom: text, baseUrl, runs, project: project === "" ? null : project })).id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), fields: raw };
  }
  redirect(`/jobs/${jobId}`);
}

export interface InspectState {
  error: string | null;
}

/** Starts a real `exegezis inspect` job (queued if another inspection is running). */
export async function startInspectionAction(_prev: InspectState, form: FormData): Promise<InspectState> {
  const text = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const result = parseInspectForm({
    url: text("url"),
    runs: text("runs"),
    maxPages: text("maxPages"),
    maxDepth: text("maxDepth"),
    checks: form.getAll("checks").filter((c) => typeof c === "string"),
    storageState: text("storageState"),
    strictReadonly: text("strictReadonly") === "on",
    ignoreRobots: text("ignoreRobots") === "on",
  });
  if (!result.ok) return { error: result.error };
  if (!isLoopbackHost(new URL(result.input.url).hostname) && text("permission") !== "on") {
    return { error: "Confirma que tienes permiso para inspeccionar este sitio." };
  }
  let jobId: string;
  try {
    jobId = (await startInspection(result.input)).id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  redirect(`/jobs/${jobId}`);
}
