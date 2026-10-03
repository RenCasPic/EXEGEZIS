"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { errorText, plansLinkFor, say } from "@/lib/action-errors";
import { checkBrowser } from "@/lib/browser-check";
import { isLoopbackHost } from "@/lib/inspect-checks";
import { probeTarget } from "@/lib/probe";
import { parseInspectForm } from "@/lib/inspect-options";
import { plannerCredentialsConfigured, startInspection, startJob } from "@/lib/jobs";
import { SCOPE_COOKIE } from "@/lib/scope";
import { ui } from "@/lib/ui-message";

export async function setScope(project: string | null, environment: string | null): Promise<void> {
  (await cookies()).set(SCOPE_COOKIE, JSON.stringify({ project, environment }), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Validation messages are catalog keys, translated when returned. */
const StartInput = z.strictObject({
  symptom: z.string().trim().min(12, "common.errors.symptomShort").max(3000, "common.errors.symptomLong"),
  expected: z.string().trim().max(1000, "common.errors.symptomLong"),
  actual: z.string().trim().max(1000, "common.errors.symptomLong"),
  baseUrl: z
    .url({ protocol: /^https?$/, error: "common.errors.targetUrl" })
    .transform((u) => (u.endsWith("/") ? u : `${u}/`)),
  runs: z.coerce.number().int("common.errors.attemptsRange").min(2, "common.errors.attemptsRange").max(20, "common.errors.attemptsRange"),
  project: z.string().max(100, "common.errors.invalidOption"),
});

export interface StartState {
  error: string | null;
  /** A plan limit: the landing's pricing («See plans»). */
  plansUrl?: string;
  fields?: Record<string, string>;
  /** Commands that fix the problem (a browser that cannot start). */
  remedy?: string[];
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
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => (i.message.startsWith("common.errors.") ? i.message : "common.errors.invalidOption")))];
    return { error: (await Promise.all(keys.map((k) => say(ui(k))))).join(" "), fields: raw };
  }
  if (!(await plannerCredentialsConfigured())) return { error: await say(ui("common.errors.noCredentials")), fields: raw };
  const { symptom, expected, actual, baseUrl, runs, project } = parsed.data;
  // The planner call costs money and time: never spend it on a target that is not up.
  const reachable = await probeTarget(baseUrl);
  if (reachable !== null) return { error: await say(reachable), fields: raw };
  // Nor on a machine where no browser can start: the plan could never be executed.
  const browser = await checkBrowser("auto");
  if (!browser.ok) return { error: await say(browser.message), remedy: browser.remedy, fields: raw };
  const text = [symptom, expected === "" ? null : `Expected: ${expected}`, actual === "" ? null : `Actual: ${actual}`].filter((l) => l !== null).join("\n");
  let jobId: string;
  try {
    jobId = (await startJob({ symptom: text, baseUrl, runs, project: project === "" ? null : project })).id;
  } catch (error) {
    return { error: await errorText(error), fields: raw, ...(await plansLinkFor(error)) };
  }
  redirect(`/jobs/${jobId}`);
}

export interface InspectState {
  error: string | null;
  /** A plan limit: the landing's pricing («See plans»). */
  plansUrl?: string;
  /** Commands that fix the problem (a browser that cannot start). */
  remedy?: string[];
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
    browserChannel: text("browserChannel") === "" ? "auto" : text("browserChannel"),
    noSession: text("noSession") === "on",
  });
  if (!result.ok) return { error: await say(result.error) };
  if (!isLoopbackHost(new URL(result.input.url).hostname) && text("permission") !== "on") return { error: await say(ui("common.errors.permissionInspect")) };
  // No job without a browser: say so here, with the fix, instead of an empty inspection.
  const browser = await checkBrowser(result.input.browserChannel);
  if (!browser.ok) return { error: await say(browser.message), remedy: browser.remedy };
  let jobId: string;
  try {
    jobId = (await startInspection(result.input)).id;
  } catch (error) {
    return { error: await errorText(error), ...(await plansLinkFor(error)) };
  }
  redirect(`/jobs/${jobId}`);
}
