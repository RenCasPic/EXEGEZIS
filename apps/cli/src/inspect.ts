import { join } from "node:path";
import { deviceScope, groupStats, SEVERITIES, ulid } from "@exegezis/core";
import { DEFAULT_DEVICES, INSPECTION_REPORT_FILE, inspectSite } from "@exegezis/inspect";
import { EXIT, UsageError, type InspectArgs } from "./args.js";
import { printEngineError } from "./doctor.js";
import { engineText, t } from "./i18n.js";
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
    case "SESSION_EXPIRED":
    case "HTTP_AUTH":
    case "CONSENT_WALL":
      return [t(`inspect.remedy.${kind}`, { origin })];
    case "BOT_CHALLENGE":
      return [t("inspect.remedy.BOT_CHALLENGE", { origin }), t("inspect.remedy.BOT_CHALLENGE_WINDOW", { origin })];
    case "RATE_LIMITED":
      return [t("inspect.remedy.RATE_LIMITED", { seconds: retryAfterSeconds === null ? "none" : String(retryAfterSeconds) })];
    case "FORBIDDEN":
    case "NETWORK_RESTRICTED":
      return [t(`inspect.remedy.${kind}`)];
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

  out(t("inspect.title"));
  out();
  out(t("common.targetLine", { url: options.url }));
  if (saved.warning !== null) io.stderr.write(`${t("inspect.warning", { message: saved.warning })}\n`);
  if (access !== null) {
    const kinds = [session ? t("inspect.kind.session") : null, access.httpCredentials === undefined ? null : t("inspect.kind.http"), access.wafToken === undefined ? null : t("inspect.kind.waf")].filter((k) => k !== null);
    out(t("inspect.accessSaved", { kinds: kinds.join(", ") }));
  } else if (options.noSession) out(t("inspect.accessAnonymous"));
  out(strict ? t("inspect.modeStrict") : t("inspect.modeReadonly"));
  const devices = options.devices ?? DEFAULT_DEVICES;
  out(t("inspect.devices", { list: devices.map((d) => t(`inspect.device.${d}`)).join(", ") }));
  if (session && options.strictReadonly === false) out(t("inspect.allowWrites"));
  out(
    t("inspect.budget", {
      pages: String(options.maxPages ?? 20),
      depth: String(options.maxDepth ?? 2),
      runs: String(options.runs),
      robots: ignoreRobots ? (robotsOwner ? t("inspect.robotsOwner") : t("inspect.robotsIgnored")) : t("inspect.robotsRespected"),
    }),
  );
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
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      ...(options.checks === undefined ? {} : { checks: options.checks }),
      ...(options.devices === undefined ? {} : { devices: options.devices }),
      ...(options.storageState === undefined ? {} : { storageState: absolute(io, options.storageState) }),
      onProgress: (p) => {
        const line =
          p.phase === "crawl" || p.phase === "repeat"
            ? t("inspect.progress", { run: String(p.run), runs: String(p.runs), done: String(p.pagesDone), planned: String(p.pagesPlanned), current: p.current === null ? "" : ` · ${p.current}` })
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
  out(t("inspect.status", { status: report.status }));
  if (report.status === "ENGINE_ERROR" && report.engineError !== null) {
    out();
    printEngineError(io, report.engineError);
    out();
    out(t("inspect.report"));
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
    out(t("inspect.block", { kind: blocked.kind, detail: engineText(blocked.message, blocked.detail) }));
    for (const line of remedyFor(blocked.kind, report.target.origin, blocked.retryAfterSeconds)) out(`         ${line}`);
  }
  if (report.skippedForSafety.length > 0) out(t("inspect.skipped", { count: report.skippedForSafety.length }));
  if (report.rateLimit.retries > 0) out(t("inspect.rateLimited", { seconds: String(Math.round(report.rateLimit.waitedSeconds)), retries: report.rateLimit.retries }));
  if (report.access.traceDropped) out(t("inspect.traceDropped"));
  const b = report.tools.browser;
  if (b !== null) out(b.system ? t("inspect.browserSystem", { channel: b.channel, version: b.version }) : t("inspect.browserPlaywright", { channel: b.channel, version: b.version }));
  const entry = report.pages.find((p) => p.depth === 0 && p.run === 1);
  if (report.status !== "COMPLETED" && entry?.reason !== null && entry?.reason !== undefined) out(t("inspect.reason", { reason: engineText(entry.reasonMessage, entry.reason) }));
  out(t("inspect.pages", { visited: s.pagesVisited, robots: report.pages.filter((p) => p.status === "SKIPPED_ROBOTS").length, external: report.externalLinks.length }));
  const g = groupStats(report.groups, report.findings);
  const bySeverity = SEVERITIES.filter((sev) => g.bySeverity[sev] > 0).map((sev) => `${sev} ${g.bySeverity[sev]}`);
  out(t("inspect.verified", { problems: g.problems, elements: g.elements, pages: g.pages, severity: bySeverity.length === 0 ? "" : ` · ${bySeverity.join(" · ")}` }));
  out(t("inspect.intermittent", { problems: g.intermittentProblems, elements: g.intermittentElements }));
  if (g.info > 0) out(t("inspect.info", { count: g.info }));
  if (s.pageWrites > 0) out(t("inspect.pageWrites", { count: s.pageWrites, blocked: options.strictReadonly === true ? "yes" : "no" }));
  if (s.discardedByPolicy > 0) out(t("inspect.discarded", { count: s.discardedByPolicy }));
  const top = report.groups.filter((x) => x.verified > 0 && x.severity !== "info");
  if (top.length > 0) {
    out();
    out(t("inspect.top", { count: top.length }));
    for (const x of top.slice(0, 5)) {
      const where = t("inspect.where", { elements: x.verified, pages: x.pages.length });
      const scope = deviceScope(report.findings.filter((f) => x.findings.includes(f.id)), report.options.devices);
      const on = scope === null ? "" : scope === "all" ? t("inspect.onAll") : t("inspect.onlyOn", { list: scope.map((d) => t(`inspect.device.${d}`)).join(", ") });
      out(`  ${x.id} [${x.severity}] ${x.title} — ${where}${on}${x.intermittent > 0 ? t("inspect.plusIntermittent", { count: x.intermittent }) : ""}`);
    }
    if (top.length > 5) out(t("inspect.more", { count: top.length - 5 }));
  }
  const verified = report.findings.filter((f) => f.verdict === "VERIFIED" && f.severity !== "info");
  out();
  out(t("inspect.report"));
  out(displayPath(io, join(dir, INSPECTION_REPORT_FILE), false));

  if (report.status === "BLOCKED" || report.status === "UNREACHABLE" || report.status === "TIMEOUT") return EXIT.inconclusive;
  return verified.length > 0 ? EXIT.expectationFailed : EXIT.ok;
}
