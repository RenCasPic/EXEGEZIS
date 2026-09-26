import { join } from "node:path";
import { SEVERITIES, ulid } from "@exegezis/core";
import { INSPECTION_REPORT_FILE, inspectSite } from "@exegezis/inspect";
import { EXIT, UsageError, type InspectArgs } from "./args.js";
import { absolute, displayPath, printer, type CliIo } from "./shared.js";

export interface InspectCommandOptions extends InspectArgs {
  output: string;
  headed: boolean;
  verbose: boolean;
  exegezisVersion: string;
}

/**
 * `exegezis inspect --url <url>`. Exit codes: 0 no VERIFIED finding above
 * info, 1 VERIFIED findings, 4 BLOCKED / UNREACHABLE / TIMEOUT (nothing could
 * be concluded about the site).
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
  const entry = report.pages.find((p) => p.depth === 0 && p.run === 1);
  if (report.status !== "COMPLETED" && entry?.reason !== null && entry?.reason !== undefined) out(`Reason:  ${entry.reason}`);
  out(`Pages:   ${s.pagesVisited} visited · ${report.pages.filter((p) => p.status === "SKIPPED_ROBOTS").length} skipped by robots.txt · ${report.externalLinks.length} external links listed, not visited`);
  out(`VERIFIED: ${SEVERITIES.map((sev) => `${sev} ${s.verified[sev]}`).join(" · ")}`);
  out(`INTERMITTENT (reported apart): ${s.intermittent}`);
  if (s.pageWrites > 0) out(`Page writes (made by the page itself, not by the inspection): ${s.pageWrites}${options.strictReadonly ? " — blocked" : ""}`);
  if (s.discardedByPolicy > 0) out(`Discarded under --strict-readonly: ${s.discardedByPolicy} observation(s) on DEGRADED pages`);
  const verified = report.findings.filter((f) => f.verdict === "VERIFIED" && f.severity !== "info");
  if (verified.length > 0) {
    out();
    out("Findings (VERIFIED):");
    for (const f of verified.slice(0, 20)) out(`  ${f.id} [${f.severity}] ${f.title}  (${new URL(f.page).pathname})`);
    if (verified.length > 20) out(`  … ${verified.length - 20} more in the report`);
  }
  out();
  out("Report:");
  out(displayPath(io, join(dir, INSPECTION_REPORT_FILE), false));

  if (report.status === "BLOCKED" || report.status === "UNREACHABLE" || report.status === "TIMEOUT") return EXIT.inconclusive;
  return verified.length > 0 ? EXIT.expectationFailed : EXIT.ok;
}
