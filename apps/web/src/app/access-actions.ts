"use server";

import { redirect } from "next/navigation";
import { accessEntry, deleteAccess, runCli, setSiteSettings } from "@/lib/access";
import { isLoopbackHost } from "@/lib/inspect-checks";
import { say } from "@/lib/action-errors";
import { ui } from "@/lib/ui-message";
import { markAccessDone, readJob, startAccessLogin, startInspection, type StartInspectionInput } from "@/lib/jobs";

/*
 * Access actions (docs/09-access.md §5). Secrets go to the CLI through stdin
 * and are never written by the web: not in job records, not in logs, not in
 * responses — except a new WAF token, returned once to the person who asked
 * for it so they can put it in their site's WAF rule.
 */

const CHANNELS = ["auto", "chromium", "chrome", "msedge"] as const;
type Channel = (typeof CHANNELS)[number];

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** The options of an earlier inspection job, to run it again once access is fixed. */
async function relaunchOf(jobId: string): Promise<StartInspectionInput | null> {
  if (!/^[0-9A-Z]{26}$/.test(jobId)) return null;
  const found = await readJob(jobId);
  if (found === null || found.job.kind !== "inspect") return null;
  const j = found.job;
  return { url: j.url, runs: j.runs, maxPages: j.maxPages, maxDepth: j.maxDepth, checks: j.checks, storageState: j.storageState, strictReadonly: j.strictReadonly, ignoreRobots: j.ignoreRobots, browserChannel: j.browserChannel, noSession: j.noSession };
}

export interface AccessState {
  error: string | null;
  done?: string;
  /** waf-token only: shown once. */
  token?: { origin: string; value: string };
}

/** "Abrir ventana para acceder": a visible window on this computer, as an access job. */
export async function openAccessWindowAction(form: FormData): Promise<void> {
  const url = text(form, "url");
  const origin = originOf(url);
  if (origin === null) throw new Error(await say(ui("access.errors.badUrl")));
  const block = text(form, "block") || null;
  // Passing a bot challenge in person: only on a site that is yours or that you may test.
  if (block === "BOT_CHALLENGE" && !isLoopbackHost(new URL(origin).hostname) && text(form, "permission") !== "on") {
    throw new Error(await say(ui("access.errors.confirmPermission")));
  }
  const channel = (CHANNELS as readonly string[]).includes(text(form, "browserChannel")) ? (text(form, "browserChannel") as Channel) : "auto";
  const job = await startAccessLogin({ url, browserChannel: channel, block, relaunch: await relaunchOf(text(form, "relaunch")) });
  redirect(`/jobs/${job.id}`);
}

/** "Listo": the person finished in the window. */
export async function accessDoneAction(form: FormData): Promise<void> {
  const id = text(form, "job");
  await markAccessDone(id);
  redirect(`/jobs/${id}`);
}

/** HTTP_AUTH: the username and password the person typed, to the CLI through stdin only. */
export async function saveHttpAuthAction(_prev: AccessState, form: FormData): Promise<AccessState> {
  const origin = originOf(text(form, "url"));
  const username = text(form, "username").trim();
  const password = text(form, "password");
  if (origin === null) return { error: await say(ui("access.errors.badUrl")) };
  if (username === "" || password === "") return { error: await say(ui("access.errors.userPassword")) };
  const result = await runCli(["session", "http-auth", "--url", `${origin}/`, "--stdin"], JSON.stringify({ username, password }));
  if (result.code !== 0) return { error: await say(ui("access.errors.notSaved", { detail: result.stderr.trim() || result.stdout.trim() })) };
  const relaunch = await relaunchOf(text(form, "relaunch"));
  if (relaunch !== null) redirect(`/jobs/${(await startInspection(relaunch)).id}`);
  return { error: null, done: await say(ui("access.errors.savedFor", { origin, username })) };
}

/** BOT_CHALLENGE option A: a token for the site's own WAF rule. Shown once. */
export async function wafTokenAction(_prev: AccessState, form: FormData): Promise<AccessState> {
  const origin = originOf(text(form, "url"));
  if (origin === null) return { error: await say(ui("access.errors.badUrl")) };
  const result = await runCli(["session", "waf-token", "--url", `${origin}/`, "--json", ...(text(form, "rotate") === "on" ? ["--rotate"] : [])]);
  if (result.code !== 0) return { error: await say(ui("access.errors.tokenFailed", { detail: result.stderr.trim() || result.stdout.trim() })) };
  const parsed = JSON.parse(result.stdout) as { origin: string; token: string };
  return { error: null, token: { origin: parsed.origin, value: parsed.token } };
}

export async function deleteAccessAction(form: FormData): Promise<void> {
  const origin = originOf(text(form, "url"));
  if (origin !== null) await deleteAccess(origin);
  redirect("/settings/access");
}

export async function robotsOwnerAction(form: FormData): Promise<void> {
  const origin = originOf(text(form, "url"));
  if (origin !== null) await setSiteSettings(origin, { robotsOwner: text(form, "robotsOwner") === "yes" });
  redirect("/settings/access");
}

/** RATE_LIMITED and similar: run the same inspection again. */
export async function relaunchInspectionAction(form: FormData): Promise<void> {
  const relaunch = await relaunchOf(text(form, "relaunch"));
  if (relaunch === null) throw new Error(await say(ui("access.errors.originalMissing")));
  redirect(`/jobs/${(await startInspection(relaunch)).id}`);
}

/** For the home: metadata only (kinds, expired), never the access itself. */
export async function accessStatusAction(url: string): Promise<{ origin: string; kinds: string[]; expired: boolean; expiresAt: string | null } | null> {
  const origin = originOf(url);
  if (origin === null) return null;
  const entry = await accessEntry(origin);
  if (entry === null) return null;
  const expired = entry.expired || (entry.expiresAt !== null && Date.parse(entry.expiresAt) < Date.now());
  return { origin, kinds: entry.kinds, expired, expiresAt: entry.expiresAt };
}
