import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { checkLimits, getProfile, recordRun, usage, type LimitReason, type RunKind } from "@exegezis/accounts";
import { db } from "./auth";
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
 * Then the run is recorded for the user (metadata, usage and ownership).
 */

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

/** Checks the request and records the run with `id`. Throws PlanLimitError or RefusedError. */
export async function gate(ws: Workspace, id: string, request: GateRequest, defaultPages: number): Promise<void> {
  if (sharedServer()) {
    if (request.storageState !== undefined && request.storageState !== null && request.storageState !== "") throw new RefusedError("serverPath");
    await assertPublicTarget(request.url);
  }
  const pages = request.pages ?? defaultPages;
  if (request.kind === "inspection" || request.kind === "search") {
    const profile = await getProfile(db(), ws.userId);
    const used = await usage(db(), ws.userId);
    const verdict = checkLimits(profile?.plan ?? "free", used, {
      kind: request.kind,
      url: request.url,
      pages,
      ...(request.meaningUsd === undefined ? {} : { meaning: { usd: request.meaningUsd } }),
    });
    if (!verdict.ok) throw new PlanLimitError(verdict.reason, verdict.limit);
  }
  await recordRun(db(), ws.userId, { id, kind: request.kind, targetUrl: request.url, pagesRequested: request.kind === "inspection" || request.kind === "search" ? pages : null, aiUsd: request.meaningUsd ?? 0 });
}
