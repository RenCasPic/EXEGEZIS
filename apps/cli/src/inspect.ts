import { join } from "node:path";
import { groupStats, SEVERITIES, ulid } from "@exegezis/core";
import { INSPECTION_REPORT_FILE, inspectSite } from "@exegezis/inspect";
import { EXIT, UsageError, type InspectArgs } from "./args.js";
import { printEngineError } from "./doctor.js";
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
export async function inspectCommand(options: InspectCommandOptions, io: CliIo): Promise<number> {
  const out = printer(io);
  const id = ulid();
  const dir = join(absolute(io, options.output), "inspections", id);

  out("EXEGEZIS INSPECT");
  out();
  out(`Target:  ${options.url}`);
  out(`Mode:    read-only${options.strictReadonly ? " (strict: the page's own writes are blocked too)" : " (the page's own writes are allowed and listed)"}`);
  out(`Budget:  ${options.maxPages ?? 20} pages, depth ${options.maxDepth ?? 2}, ${options.runs} runs · robots.txt ${options.ignoreRobots ? "ignored" : "respected"}`);
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
      strictReadonly: options.strictReadonly,
      ignoreRobots: options.ignoreRobots,
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
