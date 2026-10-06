import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, ProfileRow } from "./database.js";
import { LIMITS, type PlanId, type PlanLimits, isPlanId } from "./pricing.js";

/*
 * The accounts store, through Supabase's Data API (@supabase/supabase-js),
 * like any Supabase app (docs/13-accounts.md):
 * - with the signed-in user's session (`Db` from the app's server client):
 *   the Row Level Security policies of supabase/migrations decide what it may
 *   read or write;
 * - with the service role key (`serviceClient`), only for the operator's
 *   tasks: rate limits, deleting an account, the CLI's claim-local, plans.
 * No database password: the project URL and its API keys are enough.
 */

export type Db = SupabaseClient<Database>;

/** The operator's client (SUPABASE_SERVICE_ROLE_KEY): server only, never on a user's behalf. */
export function serviceClient(url: string, serviceRoleKey: string): Db {
  return createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUserId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The data, or the error as an exception (a store call that fails must never look like «nothing there»). */
function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error !== null) throw new Error(`${what}: ${result.error.message}`);
  return result.data as T;
}

export interface Profile {
  id: string;
  displayName: string;
  locale: "en" | "es";
  theme: "light" | "dark" | "system";
  plan: PlanId;
  termsVersion: string | null;
  privacyVersion: string | null;
  termsAcceptedAt: string | null;
  createdAt: string;
}


const iso = (v: string | null): string | null => (v === null ? null : new Date(v).toISOString());

function toProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    displayName: r.display_name,
    locale: r.locale === "es" ? "es" : "en",
    theme: r.theme === "light" || r.theme === "dark" ? r.theme : "system",
    plan: isPlanId(r.plan) ? r.plan : "free",
    termsVersion: r.terms_version,
    privacyVersion: r.privacy_version,
    termsAcceptedAt: iso(r.terms_accepted_at),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function getProfile(db: Db, userId: string): Promise<Profile | null> {
  const rows = must(await db.from("profiles").select("id, display_name, locale, theme, plan, terms_version, privacy_version, terms_accepted_at, created_at").eq("id", userId).limit(1), "getProfile") as ProfileRow[];
  return rows[0] === undefined ? null : toProfile(rows[0]);
}

export async function updateProfile(db: Db, userId: string, patch: { displayName?: string; locale?: "en" | "es"; theme?: "light" | "dark" | "system" }): Promise<void> {
  const change: Partial<ProfileRow> = { updated_at: new Date().toISOString() };
  if (patch.displayName !== undefined) change.display_name = patch.displayName.slice(0, 120);
  if (patch.locale !== undefined) change.locale = patch.locale;
  if (patch.theme !== undefined) change.theme = patch.theme;
  must(await db.from("profiles").update(change).eq("id", userId), "updateProfile");
}

export async function acceptLegal(db: Db, termsVersion: string, privacyVersion: string): Promise<void> {
  must(await db.rpc("accept_legal", { terms_version: termsVersion, privacy_version: privacyVersion }), "acceptLegal");
}

export type RunKind = "inspection" | "search" | "investigation" | "access";

/** The site a run is about: the host without a leading «www.». */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export async function recordRun(db: Db, userId: string, run: { id: string; kind: RunKind; targetUrl: string; pagesRequested: number | null; aiUsd?: number }): Promise<void> {
  must(
    await db.from("runs").insert({ id: run.id, user_id: userId, kind: run.kind, target_url: run.targetUrl.slice(0, 2048), site: siteOf(run.targetUrl).slice(0, 255), pages_requested: run.pagesRequested, ai_usd: run.aiUsd ?? 0 }),
    "recordRun",
  );
}

/** Does this user own the run (inspection, search, investigation or access job) with this id? */
export async function ownsRun(db: Db, id: string): Promise<boolean> {
  return (must(await db.from("runs").select("id").eq("id", id).limit(1), "ownsRun") as unknown[]).length > 0;
}

export interface RunRow {
  id: string;
  kind: RunKind;
  targetUrl: string;
  site: string;
  status: string;
  pagesRequested: number | null;
  aiUsd: number;
  createdAt: string;
}

export async function listRuns(db: Db): Promise<RunRow[]> {
  const rows = must(await db.from("runs").select("id, kind, target_url, site, status, pages_requested, ai_usd, created_at").order("created_at", { ascending: false }), "listRuns") as {
    id: string;
    kind: RunKind;
    target_url: string;
    site: string;
    status: string;
    pages_requested: number | null;
    ai_usd: number | string;
    created_at: string;
  }[];
  return rows.map((r) => ({ id: r.id, kind: r.kind, targetUrl: r.target_url, site: r.site, status: r.status, pagesRequested: r.pages_requested, aiUsd: Number(r.ai_usd), createdAt: new Date(r.created_at).toISOString() }));
}

export interface Usage {
  /** Inspections started this calendar month (UTC). */
  inspections: number;
  /** Pages requested this month (inspections and searches). */
  pages: number;
  /** AI spent this month, in USD (estimates recorded when a search by meaning starts). */
  aiUsd: number;
  /** Different sites ever inspected or searched. */
  sites: string[];
}

/** The first instant of this calendar month, in UTC. */
export function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function usage(db: Db): Promise<Usage> {
  const month = must(await db.from("runs").select("kind, pages_requested, ai_usd").gte("created_at", monthStart()), "usage") as { kind: RunKind; pages_requested: number | null; ai_usd: number | string }[];
  const sites = must(await db.from("runs").select("site").in("kind", ["inspection", "search"]).neq("site", ""), "usage") as { site: string }[];
  return {
    inspections: month.filter((r) => r.kind === "inspection").length,
    pages: month.filter((r) => r.kind === "inspection" || r.kind === "search").reduce((n, r) => n + (r.pages_requested ?? 0), 0),
    aiUsd: month.reduce((n, r) => n + Number(r.ai_usd), 0),
    sites: [...new Set(sites.map((s) => s.site))].sort(),
  };
}

export type LimitReason = "inspectionsPerMonth" | "pagesPerInspection" | "sites" | "meaningSearch" | "aiBalance";

export interface LimitRequest {
  kind: "inspection" | "search";
  url: string;
  pages: number;
  /** Search by meaning (AI), with its estimated cost. */
  meaning?: { usd: number };
}

/** May this request start with this plan and this month's usage? The server checks it before starting any job. */
export function checkLimits(plan: PlanId, used: Usage, request: LimitRequest): { ok: true } | { ok: false; reason: LimitReason; limit: number | boolean } {
  const limits: PlanLimits = LIMITS[plan];
  if (request.kind === "inspection" && limits.inspectionsPerMonth !== null && used.inspections >= limits.inspectionsPerMonth) return { ok: false, reason: "inspectionsPerMonth", limit: limits.inspectionsPerMonth };
  if (limits.pagesPerInspection !== null && request.pages > limits.pagesPerInspection) return { ok: false, reason: "pagesPerInspection", limit: limits.pagesPerInspection };
  const site = siteOf(request.url);
  if (limits.sites !== null && site !== "" && !used.sites.includes(site) && used.sites.length >= limits.sites) return { ok: false, reason: "sites", limit: limits.sites };
  if (request.meaning !== undefined) {
    if (!limits.meaningSearch) return { ok: false, reason: "meaningSearch", limit: false };
    if (limits.aiBalanceUsd !== null && used.aiUsd + request.meaning.usd > limits.aiBalanceUsd) return { ok: false, reason: "aiBalance", limit: limits.aiBalanceUsd };
  }
  return { ok: true };
}

export async function joinWaitlist(db: Db, userId: string, email: string, plan: "pro" | "team" | "enterprise"): Promise<void> {
  must(await db.from("waitlist").upsert({ user_id: userId, email: email.slice(0, 320), plan }, { onConflict: "user_id,plan", ignoreDuplicates: true }), "joinWaitlist");
}

export async function listWaitlist(db: Db): Promise<{ plan: string; createdAt: string }[]> {
  const rows = must(await db.from("waitlist").select("plan, created_at").order("created_at"), "listWaitlist") as { plan: string; created_at: string }[];
  return rows.map((r) => ({ plan: r.plan, createdAt: new Date(r.created_at).toISOString() }));
}

export async function listProjects(db: Db): Promise<{ id: string; name: string }[]> {
  return must(await db.from("projects").select("id, name").order("name"), "listProjects");
}

/** Everything the database holds about the signed-in user, for «Export my data». */
export async function exportAccount(db: Db): Promise<Record<string, unknown>> {
  const [profile, consents, projects, runs, waitlist, sites] = await Promise.all([
    db.from("profiles").select("*").limit(1),
    db.from("consents").select("document, version, accepted_at").order("accepted_at"),
    db.from("projects").select("id, name, created_at").order("created_at"),
    db.from("runs").select("id, kind, target_url, site, status, pages_requested, ai_usd, created_at, finished_at").order("created_at"),
    db.from("waitlist").select("plan, email, created_at").order("created_at"),
    db.from("site_verifications").select("site, method, verified_at, created_at").order("created_at"),
  ]);
  return {
    profile: (must(profile, "exportAccount") as unknown[])[0] ?? null,
    consents: must(consents, "exportAccount"),
    projects: must(projects, "exportAccount"),
    runs: must(runs, "exportAccount"),
    waitlist: must(waitlist, "exportAccount"),
    sites: must(sites, "exportAccount"),
  };
}

// ---- Site ownership (inspections and searches of more than OWNERSHIP_PAGES pages) ----

export interface SiteVerification {
  site: string;
  /** What to put on the site: <meta name="exegezis-site-verification" content="…"> or a TXT record exegezis-site-verification=… */
  token: string;
  method: "meta" | "dns" | null;
  verifiedAt: string | null;
}

export async function listSites(db: Db): Promise<SiteVerification[]> {
  const rows = must(await db.from("site_verifications").select("site, token, method, verified_at").order("site"), "listSites");
  return rows.map((r) => ({ site: r.site, token: r.token, method: r.method === "meta" || r.method === "dns" ? r.method : null, verifiedAt: r.verified_at === null ? null : new Date(r.verified_at).toISOString() }));
}

/** Adds a site to verify, with a new token (an existing one keeps its token). */
export async function addSite(db: Db, userId: string, site: string): Promise<void> {
  must(await db.from("site_verifications").upsert({ user_id: userId, site: site.slice(0, 255), token: randomBytes(16).toString("hex") }, { onConflict: "user_id,site", ignoreDuplicates: true }), "addSite");
}

export async function removeSite(db: Db, site: string): Promise<void> {
  must(await db.from("site_verifications").delete().eq("site", site), "removeSite");
}

/** Has the signed-in user verified this site (siteOf: the host without «www.»)? */
export async function isSiteVerified(db: Db, site: string): Promise<boolean> {
  const rows = must(await db.from("site_verifications").select("verified_at").eq("site", site).limit(1), "isSiteVerified");
  return rows[0]?.verified_at !== null && rows[0]?.verified_at !== undefined;
}

/** The signed-in user's AI spending since `since` (their own runs). */
export async function aiSpentSince(db: Db, since: string): Promise<number> {
  const rows = must(await db.from("runs").select("ai_usd").gte("created_at", since), "aiSpentSince");
  return rows.reduce((n, r) => n + Number(r.ai_usd), 0);
}

// ---- Operator tasks: the service role client, never on a user's behalf ----

/** The server checked the site: the token is on it. */
export async function markSiteVerified(admin: Db, userId: string, site: string, method: "meta" | "dns"): Promise<void> {
  must(await admin.from("site_verifications").update({ method, verified_at: new Date().toISOString() }).eq("user_id", userId).eq("site", site), "markSiteVerified");
}

/** What every user together has spent on AI since `since` (the daily global cap). */
export async function aiSpentByEveryone(admin: Db, since: string): Promise<number> {
  return Number(must(await admin.rpc("ai_spent_since", { p_since: since }), "aiSpentByEveryone"));
}

/**
 * Deletes the account: its auth user and, by cascade, every row of every
 * table. The caller deletes the user's artifacts folder.
 */
export async function deleteUser(admin: Db, userId: string): Promise<void> {
  if (!isUserId(userId)) throw new Error("deleteUser: not a user id");
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error !== null) throw new Error(`deleteUser: ${error.message}`);
}

/** Counts one attempt for `key`; false when it is over `limit` attempts in `windowSeconds`. */
export async function consumeRateLimit(admin: Db, key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const rows = must(await admin.rpc("consume_rate_limit", { p_key: key.slice(0, 300), p_limit: limit, p_window_seconds: windowSeconds }), "consumeRateLimit") as { allowed: boolean; retry_after_seconds: number }[];
  const row = rows[0];
  return row === undefined ? { allowed: true, retryAfterSeconds: 0 } : { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}

/** The account to give the CLI's data to: by email, or the first one created. */
export async function findClaimant(admin: Db, email: string | null): Promise<{ id: string; email: string } | null> {
  const all: { id: string; email: string; createdAt: string }[] = [];
  for (let page = 1; page < 1000; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error !== null) throw new Error(`findClaimant: ${error.message}`);
    all.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? "", createdAt: u.created_at })));
    if (data.users.length < 200) break;
  }
  const found = email === null ? all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] : all.find((u) => u.email.toLowerCase() === email.toLowerCase());
  return found === undefined ? null : { id: found.id, email: found.email };
}

/** Records runs found on disk as the user's (claim-local). Existing ids are left as they are. */
export async function adoptRuns(admin: Db, userId: string, runs: readonly { id: string; kind: RunKind; targetUrl: string; createdAt: string | null; pagesRequested: number | null }[]): Promise<number> {
  if (runs.length === 0) return 0;
  const rows = runs.map((r) => ({
    id: r.id,
    user_id: userId,
    kind: r.kind,
    target_url: r.targetUrl.slice(0, 2048),
    site: siteOf(r.targetUrl).slice(0, 255),
    status: "done",
    pages_requested: r.pagesRequested,
    created_at: r.createdAt ?? new Date().toISOString(),
  }));
  const added = must(await admin.from("runs").upsert(rows, { onConflict: "id", ignoreDuplicates: true }).select("id"), "adoptRuns");
  return added.length;
}

export async function setPlan(admin: Db, userId: string, plan: PlanId): Promise<void> {
  must(await admin.from("profiles").update({ plan, updated_at: new Date().toISOString() }).eq("id", userId), "setPlan");
}
