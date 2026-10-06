import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  aiDailyCaps,
  aiSpentByEveryone,
  aiSpentSince,
  checkLimits,
  consumeRateLimit,
  dayStart,
  getProfile,
  HOURLY_PER_IP,
  HOURLY_PER_USER,
  INVESTIGATION_AI_USD,
  isSiteVerified,
  OWNERSHIP_PAGES,
  recordRun,
  siteOf,
  usage,
  type LimitReason,
  type RunKind,
} from "@exegezis/accounts";
import { clientIp } from "./account";
import { adminDb, supabase } from "./auth";
import type { Workspace } from "./user-workspace";

/*
 * What the server checks before starting any job. It runs inside lib/jobs.ts,
 * so no form or route can skip it.
 * - On a shared server (a production build, serving other people):
 *   - the target must be a public address: no loopback, private, link-local
 *     or metadata addresses (the server must not inspect its own network);
 *   - no file paths of the server (storageState), no visible browser window.
 *   `pnpm web` on your own machine (development) allows them.
 * - The plan's limits (packages/accounts/src/pricing.ts) with this month's usage.
 * - More than OWNERSHIP_PAGES pages: the site must be verified as the user's
 *   (a meta tag or a DNS TXT record, Settings → Sites).
 * - AI work (search by meaning, investigations): the daily caps per user and
 *   for everyone together (packages/accounts/src/abuse.ts).
 * - Jobs per hour, per user (by plan) and per address.
 * Then the run is recorded for the user (metadata, usage and ownership).
 */

/** Refused to protect the service: too many in a row, a site not verified, the daily AI cap. */
export class AbuseError extends Error {
  override readonly name = "AbuseError";
  constructor(
    readonly reason: "tooMany" | "ownership" | "aiDailyUser" | "aiDailyTotal",
    readonly values: Record<string, string | number> = {},
  ) {
    super(`refused: ${reason}`);
  }
}

/** The plan does not allow it: the UI says why and offers «See plans». */
export class PlanLimitError extends Error {
  override readonly name = "PlanLimitError";
  constructor(
    readonly reason: LimitReason,
    readonly limit: number | boolean,
  ) {
    super(`plan limit: ${reason}`);
  }
}

/** Not allowed on a shared server (a private address, a server path…). */
export class RefusedError extends Error {
  override readonly name = "RefusedError";
  constructor(readonly reason: "privateAddress" | "serverPath" | "visibleWindow") {
    super(`refused on a shared server: ${reason}`);
  }
}

/** A production build serves other people; `pnpm web` (development) runs on the user's own machine. */
export function sharedServer(): boolean {
  return process.env.NODE_ENV === "production";
}

function privateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** True for addresses a shared server must never visit on a user's behalf. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return privateV4(ip);
  if (v !== 6) return true;
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1] !== undefined) return privateV4(mapped[1]);
  return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
}

/** The URL's host resolves only to public addresses (every address it resolves to is checked). */
export async function assertPublicTarget(url: string): Promise<void> {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new RefusedError("privateAddress");
    host = u.hostname.replace(/^\[|\]$/g, "");
  } catch (error) {
    if (error instanceof RefusedError) throw error;
    throw new RefusedError("privateAddress");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new RefusedError("privateAddress");
  const addresses = isIP(host) !== 0 ? [host] : (await lookup(host, { all: true, verbatim: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new RefusedError("privateAddress");
}

export interface GateRequest {
  kind: RunKind;
  url: string;
  /** Pages requested (--max-pages); null: the default. */
  pages: number | null;
  /** Search by meaning: its cost ceiling in USD. */
  meaningUsd?: number;
  storageState?: string | null;
}

/** Checks the request and records the run with `id`. Throws RefusedError, AbuseError or PlanLimitError. */
export async function gate(ws: Workspace, id: string, request: GateRequest, defaultPages: number): Promise<void> {
  if (sharedServer()) {
    if (request.storageState !== undefined && request.storageState !== null && request.storageState !== "") throw new RefusedError("serverPath");
    await assertPublicTarget(request.url);
  }
  const pages = request.pages ?? defaultPages;
  const sb = await supabase();
  const profile = await getProfile(sb, ws.userId);
  const plan = profile?.plan ?? "free";
  const crawls = request.kind === "inspection" || request.kind === "search";

  // The plan first: what it does not allow, no verification can allow.
  if (request.kind === "inspection" || request.kind === "search") {
    const used = await usage(sb);
    const verdict = checkLimits(plan, used, {
      kind: request.kind,
      url: request.url,
      pages,
      ...(request.meaningUsd === undefined ? {} : { meaning: { usd: request.meaningUsd } }),
    });
    if (!verdict.ok) throw new PlanLimitError(verdict.reason, verdict.limit);
  }

  // A big crawl only of the user's own site.
  if (crawls && pages > OWNERSHIP_PAGES) {
    const site = siteOf(request.url);
    if (!(await isSiteVerified(sb, site))) throw new AbuseError("ownership", { site, pages: OWNERSHIP_PAGES });
  }

  // AI work within the daily caps.
  const ai = request.kind === "investigation" ? INVESTIGATION_AI_USD : (request.meaningUsd ?? 0);
  if (ai > 0) {
    const caps = aiDailyCaps();
    if ((await aiSpentSince(sb, dayStart())) + ai > caps.user) throw new AbuseError("aiDailyUser", { limit: caps.user });
    if ((await aiSpentByEveryone(adminDb(), dayStart())) + ai > caps.total) {
      // For the operator, in the server's log.
      process.stderr.write(`[exegezis] the daily AI cap for everyone (${caps.total} USD, EXEGEZIS_AI_DAILY_TOTAL_USD) is reached: AI work is refused until tomorrow (UTC)\n`);
      throw new AbuseError("aiDailyTotal");
    }
  }

  // Bursts: counted last, so a refusal above does not use up the hour.
  if (request.kind === "inspection" || request.kind === "search" || request.kind === "investigation") {
    const perUser = HOURLY_PER_USER[plan][request.kind];
    const checks = [
      ...(perUser === null ? [] : [{ key: `run:${request.kind}:user:${ws.userId}`, limit: perUser }]),
      { key: `run:${request.kind}:ip:${await clientIp()}`, limit: HOURLY_PER_IP[request.kind] },
    ];
    for (const c of checks) {
      const r = await consumeRateLimit(adminDb(), c.key, c.limit, 3600);
      if (!r.allowed) throw new AbuseError("tooMany", { minutes: Math.max(1, Math.ceil(r.retryAfterSeconds / 60)) });
    }
  }

  await recordRun(sb, ws.userId, { id, kind: request.kind, targetUrl: request.url, pagesRequested: crawls ? pages : null, aiUsd: ai });
}
