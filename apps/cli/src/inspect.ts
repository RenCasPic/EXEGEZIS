import { join } from "node:path";
import { groupStats, SEVERITIES, ulid } from "@exegezis/core";
import { INSPECTION_REPORT_FILE, inspectSite } from "@exegezis/inspect";
import { EXIT, UsageError, type InspectArgs } from "./args.js";
import { printEngineError } from "./doctor.js";
import { loadAccess, openStore } from "./session.js";
import { absolute, displayPath, printer, type CliIo } from "./shared.js";

export interface InspectCommandOptions extends InspectArgs {
  output: string;
  headed: boolean;
  browserChannel: "auto" | "chromium" | "chrome" | "msedge";
  verbose: boolean;
  exegezisVersion: string;
}

/**
 * `exegezis inspect --url <url>`. Exit codes: 0 no VERIFIED finding above
 * info, 1 VERIFIED findings, 4 BLOCKED / UNREACHABLE / TIMEOUT (nothing could
 * be concluded about the site), 7 ENGINE_ERROR (no browser could start on
 * this machine; the site was not judged).
 */
/** What to do about each block kind (the same commands work in Windows CMD, PowerShell, macOS and Linux). */
export function remedyFor(kind: string, origin: string, retryAfterSeconds: number | null): string[] {
  switch (kind) {
    case "LOGIN_WALL":
      return [`Sign in once in a window (you type, EXEGEZIS only keeps this site's cookies): pnpm exegezis session login --url ${origin}/`];
    case "SESSION_EXPIRED":
      return [`The saved session expired. Renew it: pnpm exegezis session login --url ${origin}/`];
    case "HTTP_AUTH":
      return [`Save the site's username and password (asked without echo): pnpm exegezis session http-auth --url ${origin}/`];
    case "BOT_CHALLENGE":
      return [
        `Your own site: authorize EXEGEZIS in its WAF: pnpm exegezis session waf-token --url ${origin}/`,
        `Or pass the verification yourself in a window (only a site that is yours or that you may test): pnpm exegezis session login --url ${origin}/`,
      ];
    case "CONSENT_WALL":
      return [`Choose in the cookie banner once (the most private option is fine): pnpm exegezis session login --url ${origin}/`];
    case "RATE_LIMITED":
      return [`The site asked to slow down${retryAfterSeconds === null ? "" : ` for ${retryAfterSeconds} s`}. Wait and run the inspection again, with fewer pages (--max-pages) or a longer --delay.`];
    case "FORBIDDEN":
      return ["The site refuses this computer (IP, country or a WAF rule). If it is yours: allow this IP, or use pnpm exegezis session waf-token. Retrying will not help."];
    case "NETWORK_RESTRICTED":
      return ["The site is not reachable from this network (VPN, intranet or private DNS). Connect to that network and try again."];
    default:
      return [];
  }
}

export async function inspectCommand(options: InspectCommandOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const id = ulid();
  const dir = join(absolute(io, options.output), "inspections", id);

  // Saved access of the origin (docs/09-access.md), unless --no-session.
  const saved = options.noSession ? { access: null, entry: null, warning: null } : await loadAccess(options.url, io);
  const access = saved.access;
  const session = access?.storageState !== undefined;
  const strict = options.strictReadonly ?? session;
  const robotsOwner = saved.entry?.settings.robotsOwner === true;
  const ignoreRobots = options.ignoreRobots || robotsOwner;

  out("EXEGEZIS INSPECT");
  out();
  out(`Target:  ${options.url}`);
  if (saved.warning !== null) io.stderr.write(`Warning: ${saved.warning}\n`);
  if (access !== null) {
    const kinds = [session ? "session" : null, access.httpCredentials === undefined ? null : "HTTP credentials", access.wafToken === undefined ? null : "WAF token"].filter((k) => k !== null);
    out(`Access:  with saved ${kinds.join(", ")} (--no-session to inspect as an anonymous visitor)`);
  } else if (options.noSession) out("Access:  anonymous visitor (--no-session)");
  out(`Mode:    read-only${strict ? " (strict: the page's own writes are blocked too)" : " (the page's own writes are allowed and listed)"}`);
  if (session && options.strictReadonly === false) out("Warning: --allow-page-writes with a saved session: the pages you are signed in to can send writes to the site.");
  out(`Budget:  ${options.maxPages ?? 20} pages, depth ${options.maxDepth ?? 2}, ${options.runs} runs · robots.txt ${ignoreRobots ? (robotsOwner ? "exclusions inspected too (your site)" : "ignored") : "respected"}`);
  out();

  let lastLine = "";
  let report;
  try {
    report = await inspectSite({
      url: options.url,
      dir,
      id,
      exegezisVersion: options.exegezisVersion,
      runs: options.runs,
      strictReadonly: strict,
      ignoreRobots,
      access,
      ...(saved.entry === null ? {} : { unsafeLinkPatterns: saved.entry.settings.unsafeLinkPatterns }),
      headed: options.headed,
      browserChannel: options.browserChannel,
      ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
      ...(options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth }),
      ...(options.pageTimeoutMs === undefined ? {} : { pageTimeoutMs: options.pageTimeoutMs }),
      ...(options.totalTimeoutMs === undefined ? {} : { totalTimeoutMs: options.totalTimeoutMs }),
      ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
      ...(options.checks === undefined ? {} : { checks: options.checks }),
      ...(options.storageState === undefined ? {} : { storageState: absolute(io, options.storageState) }),
      onProgress: (p) => {
        const line =
          p.phase === "crawl" || p.phase === "repeat"
            ? `  run ${p.run}/${p.runs} · ${p.pagesDone}/${p.pagesPlanned} pages${p.current === null ? "" : ` · ${p.current}`}`
            : `  ${p.phase}`;
        if (line !== lastLine) out(line);
        lastLine = line;
      },
    });
  } catch (error) {
    if (error instanceof Error && /unknown check/.test(error.message)) throw new UsageError(error.message);
    throw error;
  }

  const s = report.summary;
  out();
  out(`Status:  ${report.status}`);
  if (report.status === "ENGINE_ERROR" && report.engineError !== null) {
    out();
    printEngineError(io, report.engineError);
    out();
    out("Report:");
    out(displayPath(io, join(dir, INSPECTION_REPORT_FILE), false));
    return EXIT.engineError;
  }
  if (access !== null) {
    const store = openStore();
    const expired = report.pages.some((p) => p.block?.kind === "SESSION_EXPIRED");
    await store.touch(options.url, { lastUsedAt: new Date().toISOString(), ...(expired ? { expired: true } : {}) });
  }
  const blocked = report.pages.find((p) => p.depth === 0 && p.run === 1)?.block ?? null;
  if (blocked !== null) {
    out(`Block:   ${blocked.kind} — ${blocked.detail}`);
    for (const line of remedyFor(blocked.kind, report.target.origin, blocked.retryAfterSeconds)) out(`         ${line}`);
  }
  if (report.skippedForSafety.length > 0) out(`Skipped for safety (logout or destructive links, never visited): ${report.skippedForSafety.length}`);
  if (report.rateLimit.retries > 0) out(`Rate limited: waited ${Math.round(report.rateLimit.waitedSeconds)} s over ${report.rateLimit.retries} retr${report.rateLimit.retries === 1 ? "y" : "ies"}, then continued more slowly`);
  if (report.access.traceDropped) out("Trace:   not kept (it held values of the saved access that could not be removed)");
  const b = report.tools.browser;
  if (b !== null) out(`Browser: ${b.channel} ${b.version}${b.system ? " (installed on this system, not Playwright's own Chromium)" : " (Playwright's Chromium)"}`);
  const entry = report.pages.find((p) => p.depth === 0 && p.run === 1);
  if (report.status !== "COMPLETED" && entry?.reason !== null && entry?.reason !== undefined) out(`Reason:  ${entry.reason}`);
  out(`Pages:   ${s.pagesVisited} visited · ${report.pages.filter((p) => p.status === "SKIPPED_ROBOTS").length} skipped by robots.txt · ${report.externalLinks.length} external links listed, not visited`);
  const g = groupStats(report.groups, report.findings);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const bySeverity = SEVERITIES.filter((sev) => g.bySeverity[sev] > 0).map((sev) => `${sev} ${g.bySeverity[sev]}`);
  out(`VERIFIED: ${plural(g.problems, "problem", "problems")} (${plural(g.elements, "element", "elements")} on ${plural(g.pages, "page", "pages")})${bySeverity.length === 0 ? "" : ` · ${bySeverity.join(" · ")}`}`);
  out(`INTERMITTENT (reported apart): ${plural(g.intermittentProblems, "problem", "problems")} (${plural(g.intermittentElements, "element", "elements")})`);
  if (g.info > 0) out(`Info: ${plural(g.info, "item", "items")} (SEO basics, not counted as problems)`);
  if (s.pageWrites > 0) out(`Page writes (made by the page itself, not by the inspection): ${s.pageWrites}${options.strictReadonly ? " — blocked" : ""}`);
  if (s.discardedByPolicy > 0) out(`Discarded under --strict-readonly: ${s.discardedByPolicy} observation(s) on DEGRADED pages`);
  const top = report.groups.filter((x) => x.verified > 0 && x.severity !== "info");
  if (top.length > 0) {
    out();
    out(`Top problems (of ${top.length}, by impact):`);
    for (const x of top.slice(0, 5)) {
      const where = `${plural(x.verified, "element", "elements")}, ${plural(x.pages.length, "page", "pages")}`;
      out(`  ${x.id} [${x.severity}] ${x.title} — ${where}${x.intermittent > 0 ? ` (+${x.intermittent} intermittent)` : ""}`);
    }
    if (top.length > 5) out(`  … ${top.length - 5} more in the report`);
  }
  const verified = report.findings.filter((f) => f.verdict === "VERIFIED" && f.severity !== "info");
  out();
  out("Report:");
  out(displayPath(io, join(dir, INSPECTION_REPORT_FILE), false));

  if (report.status === "BLOCKED" || report.status === "UNREACHABLE" || report.status === "TIMEOUT") return EXIT.inconclusive;
  return verified.length > 0 ? EXIT.expectationFailed : EXIT.ok;
}
