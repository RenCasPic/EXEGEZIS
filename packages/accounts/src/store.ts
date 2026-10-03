import postgres from "postgres";
import { LIMITS, type PlanId, type PlanLimits, isPlanId } from "./pricing.js";

/*
 * The accounts store. The app connects as the database owner
 * (DATABASE_URL) and does everything on a user's behalf inside `asUser`,
 * which switches the transaction to the `authenticated` role with that
 * user's id: the Row Level Security policies of
 * supabase/migrations/*_accounts.sql then decide what it may read or write.
 * Only a few operator tasks (rate limits, deleting an account, assigning the
 * local data) use the owner connection directly.
 */

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function connect(databaseUrl: string, options: { max?: number } = {}): Sql {
  const max = options.max ?? Number(process.env["EXEGEZIS_DB_MAX_CONNECTIONS"] ?? "5");
  return postgres(databaseUrl, {
    max: Number.isFinite(max) && max > 0 ? max : 5,
    // Supabase's connection pooler (transaction mode) does not keep prepared statements.
    prepare: false,
    onnotice: () => undefined,
    idle_timeout: 30,
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUserId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Runs `fn` as the signed-in user: Row Level Security applies to every statement. */
export async function asUser<T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isUserId(userId)) throw new Error("asUser: not a user id");
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return (await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId}, true), set_config('request.jwt.claim.role', 'authenticated', true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  })) as T;
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

interface ProfileRow {
  id: string;
  display_name: string;
  locale: string;
  theme: string;
  plan: string;
  terms_version: string | null;
  privacy_version: string | null;
  terms_accepted_at: Date | null;
  created_at: Date;
}

function toProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    displayName: r.display_name,
    locale: r.locale === "es" ? "es" : "en",
    theme: r.theme === "light" || r.theme === "dark" ? r.theme : "system",
    plan: isPlanId(r.plan) ? r.plan : "free",
    termsVersion: r.terms_version,
    privacyVersion: r.privacy_version,
    termsAcceptedAt: r.terms_accepted_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

export async function getProfile(sql: Sql, userId: string): Promise<Profile | null> {
  return asUser(sql, userId, async (tx) => {
    const rows = await tx<ProfileRow[]>`select id, display_name, locale, theme, plan, terms_version, privacy_version, terms_accepted_at, created_at from public.profiles where id = ${userId}`;
    return rows[0] === undefined ? null : toProfile(rows[0]);
  });
}

export async function updateProfile(sql: Sql, userId: string, patch: { displayName?: string; locale?: "en" | "es"; theme?: "light" | "dark" | "system" }): Promise<void> {
  await asUser(sql, userId, async (tx) => {
    const current = await tx<ProfileRow[]>`select display_name, locale, theme from public.profiles where id = ${userId}`;
    const row = current[0];
    if (row === undefined) return;
    await tx`update public.profiles set display_name = ${(patch.displayName ?? row.display_name).slice(0, 120)}, locale = ${patch.locale ?? row.locale}, theme = ${patch.theme ?? row.theme}, updated_at = now() where id = ${userId}`;
  });
}

export async function acceptLegal(sql: Sql, userId: string, termsVersion: string, privacyVersion: string): Promise<void> {
  await asUser(sql, userId, async (tx) => {
    await tx`select public.accept_legal(${termsVersion}, ${privacyVersion})`;
  });
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

export async function recordRun(sql: Sql, userId: string, run: { id: string; kind: RunKind; targetUrl: string; pagesRequested: number | null; aiUsd?: number }): Promise<void> {
  await asUser(sql, userId, async (tx) => {
    await tx`insert into public.runs (id, user_id, kind, target_url, site, pages_requested, ai_usd)
      values (${run.id}, ${userId}, ${run.kind}, ${run.targetUrl.slice(0, 2048)}, ${siteOf(run.targetUrl).slice(0, 255)}, ${run.pagesRequested}, ${run.aiUsd ?? 0})`;
  });
}

/** Does this user own the run (inspection, search, investigation or access job) with this id? */
export async function ownsRun(sql: Sql, userId: string, id: string): Promise<boolean> {
  return asUser(sql, userId, async (tx) => (await tx`select 1 from public.runs where id = ${id}`).length > 0);
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

export async function listRuns(sql: Sql, userId: string): Promise<RunRow[]> {
  return asUser(sql, userId, async (tx) => {
    const rows = await tx<{ id: string; kind: RunKind; target_url: string; site: string; status: string; pages_requested: number | null; ai_usd: string; created_at: Date }[]>`
      select id, kind, target_url, site, status, pages_requested, ai_usd, created_at from public.runs order by created_at desc`;
    return rows.map((r) => ({ id: r.id, kind: r.kind, targetUrl: r.target_url, site: r.site, status: r.status, pagesRequested: r.pages_requested, aiUsd: Number(r.ai_usd), createdAt: r.created_at.toISOString() }));
  });
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

export async function usage(sql: Sql, userId: string): Promise<Usage> {
  return asUser(sql, userId, async (tx) => {
    const month = await tx<{ inspections: string; pages: string | null; ai: string | null }[]>`
      select count(*) filter (where kind = 'inspection') as inspections,
             sum(pages_requested) filter (where kind in ('inspection', 'search')) as pages,
             sum(ai_usd) as ai
      from public.runs
      where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`;
    const sites = await tx<{ site: string }[]>`select distinct site from public.runs where kind in ('inspection', 'search') and site <> '' order by site`;
    const m = month[0];
    return { inspections: Number(m?.inspections ?? 0), pages: Number(m?.pages ?? 0), aiUsd: Number(m?.ai ?? 0), sites: sites.map((s) => s.site) };
  });
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

export async function joinWaitlist(sql: Sql, userId: string, email: string, plan: "pro" | "team" | "enterprise"): Promise<void> {
  await asUser(sql, userId, async (tx) => {
    await tx`insert into public.waitlist (user_id, email, plan) values (${userId}, ${email.slice(0, 320)}, ${plan}) on conflict (user_id, plan) do nothing`;
  });
}

export async function listWaitlist(sql: Sql, userId: string): Promise<{ plan: string; createdAt: string }[]> {
  return asUser(sql, userId, async (tx) => (await tx<{ plan: string; created_at: Date }[]>`select plan, created_at from public.waitlist order by created_at`).map((r) => ({ plan: r.plan, createdAt: r.created_at.toISOString() })));
}

export async function listProjects(sql: Sql, userId: string): Promise<{ id: string; name: string }[]> {
  return asUser(sql, userId, async (tx) => tx<{ id: string; name: string }[]>`select id, name from public.projects order by name`);
}

/** Everything the database holds about a user, for «Export my data». */
export async function exportAccount(sql: Sql, userId: string): Promise<Record<string, unknown>> {
  return asUser(sql, userId, async (tx) => ({
    profile: (await tx`select * from public.profiles`)[0] ?? null,
    consents: [...(await tx`select document, version, accepted_at from public.consents order by accepted_at`)],
    projects: [...(await tx`select id, name, created_at from public.projects order by created_at`)],
    runs: [...(await tx`select id, kind, target_url, site, status, pages_requested, ai_usd, created_at, finished_at from public.runs order by created_at`)],
    waitlist: [...(await tx`select plan, email, created_at from public.waitlist order by created_at`)],
  }));
}

// ---- Operator tasks: the owner connection, never on a user's behalf ----

/**
 * Deletes the account: its auth user and, by cascade, every row of every
 * table. The caller deletes the user's artifacts folder.
 */
export async function deleteUser(sql: Sql, userId: string): Promise<void> {
  if (!isUserId(userId)) throw new Error("deleteUser: not a user id");
  await sql`delete from auth.users where id = ${userId}`;
}

/** Counts one attempt for `key`; false when it is over `limit` attempts in `windowSeconds`. */
export async function consumeRateLimit(sql: Sql, key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const rows = await sql<{ hits: number; window_start: Date }[]>`
    insert into public.rate_limits as r (key, window_start, hits) values (${key.slice(0, 300)}, now(), 1)
    on conflict (key) do update set
      hits = case when r.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else r.hits + 1 end,
      window_start = case when r.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else r.window_start end
    returning hits, window_start`;
  const row = rows[0];
  if (row === undefined) return { allowed: true, retryAfterSeconds: 0 };
  const retry = Math.max(0, Math.ceil(windowSeconds - (Date.now() - row.window_start.getTime()) / 1000));
  return { allowed: row.hits <= limit, retryAfterSeconds: row.hits <= limit ? 0 : retry };
}

/** The account to give the local data to: by email, or the first one created. */
export async function findClaimant(sql: Sql, email: string | null): Promise<{ id: string; email: string } | null> {
  const rows =
    email === null
      ? await sql<{ id: string; email: string }[]>`select id, email from auth.users order by created_at asc limit 1`
      : await sql<{ id: string; email: string }[]>`select id, email from auth.users where lower(email) = lower(${email}) limit 1`;
  return rows[0] ?? null;
}

/** Records runs found on disk as the user's (claim-local). Existing ids are left as they are. */
export async function adoptRuns(sql: Sql, userId: string, runs: readonly { id: string; kind: RunKind; targetUrl: string; createdAt: string | null; pagesRequested: number | null }[]): Promise<number> {
  let added = 0;
  for (const r of runs) {
    const res = await sql`insert into public.runs (id, user_id, kind, target_url, site, status, pages_requested, created_at)
      values (${r.id}, ${userId}, ${r.kind}, ${r.targetUrl.slice(0, 2048)}, ${siteOf(r.targetUrl).slice(0, 255)}, 'done', ${r.pagesRequested}, ${r.createdAt ?? new Date().toISOString()})
      on conflict (id) do nothing`;
    added += res.count;
  }
  return added;
}

export async function setPlan(sql: Sql, userId: string, plan: PlanId): Promise<void> {
  await sql`update public.profiles set plan = ${plan}, updated_at = now() where id = ${userId}`;
}
