import { z } from "zod";
import { Assertion } from "./assertion.js";
import { EngineErrorInfo } from "../engine.js";
import { canonicalJson } from "../hash.js";
import { deriveIssueGroups } from "../issue-groups.js";
import { Timestamp } from "./common.js";
import { EvidenceRef } from "./verification.js";

/*
 * Web inspection (docs/07-web-inspection.md): open a URL without a symptom,
 * walk it read-only and report deterministic findings. The report stores raw
 * measurements (`checks[].observations` per page and run); the verdict of every
 * finding, the counts and the overall status are re-derived from them when the
 * report is loaded, so a report that does not follow from its measurements
 * does not load.
 */

export const Severity = z.enum(["critical", "serious", "moderate", "minor", "info"]);
export type Severity = z.infer<typeof Severity>;
export const SEVERITIES: readonly Severity[] = Severity.options;

/**
 * - `OK`: loaded (the document answered < 400).
 * - `HTTP_ERROR`: the document answered ≥ 400 (still checked: it is a finding source).
 * - `DEGRADED`: --strict-readonly blocked writes the page tried to make.
 * - `BLOCKED`: anti-bot, CAPTCHA, login wall or 451. Never bypassed.
 * - `UNREACHABLE`: DNS, TLS or connection failure.
 * - `TIMEOUT`: the navigation did not finish in time.
 * - `SKIPPED_BUDGET` / `SKIPPED_ROBOTS`: discovered but not visited.
 */
export const PageStatus = z.enum(["OK", "HTTP_ERROR", "DEGRADED", "BLOCKED", "UNREACHABLE", "TIMEOUT", "SKIPPED_BUDGET", "SKIPPED_ROBOTS"]);
export type PageStatus = z.infer<typeof PageStatus>;

/** Visits whose evidence the checks may use. */
export const INSPECTABLE: readonly PageStatus[] = ["OK", "HTTP_ERROR", "DEGRADED"];

/**
 * Why a page could not be inspected (docs/09-access.md). Detection order:
 * HTTP_AUTH → BOT_CHALLENGE → SESSION_EXPIRED → LOGIN_WALL → CONSENT_WALL →
 * RATE_LIMITED → FORBIDDEN. NETWORK_RESTRICTED is not a block of the site: it
 * qualifies an UNREACHABLE visit. A block never produces findings.
 */
export const BlockKind = z.enum([
  "HTTP_AUTH",
  "BOT_CHALLENGE",
  "SESSION_EXPIRED",
  "LOGIN_WALL",
  "CONSENT_WALL",
  "RATE_LIMITED",
  "FORBIDDEN",
  "NETWORK_RESTRICTED",
]);
export type BlockKind = z.infer<typeof BlockKind>;
export const BLOCK_ORDER: readonly BlockKind[] = ["HTTP_AUTH", "BOT_CHALLENGE", "SESSION_EXPIRED", "LOGIN_WALL", "CONSENT_WALL", "RATE_LIMITED", "FORBIDDEN"];

export const BlockInfo = z.strictObject({
  kind: BlockKind,
  /** What was seen, in one line (English, for logs; the UI words it in Spanish). */
  detail: z.string(),
  evidence: z.strictObject({
    finalUrl: z.string().nullable(),
    httpStatus: z.int().nullable(),
    /** Only the headers that explain the block (www-authenticate scheme, retry-after, cf-mitigated, server…). */
    headers: z.record(z.string(), z.string()),
    /** Names of known anti-bot / session cookies. Never their values. */
    cookieNames: z.array(z.string()),
    markers: z.array(z.string()),
    /** Screenshot of the blocked page, relative to the inspection directory. */
    screenshot: z.string().nullable(),
  }),
  /** RATE_LIMITED: seconds the site asked to wait (Retry-After), if it said. */
  retryAfterSeconds: z.number().nonnegative().nullable(),
});
export type BlockInfo = z.infer<typeof BlockInfo>;

export const PageVisit = z.strictObject({
  /** Normalized URL (no fragment). */
  url: z.string(),
  depth: z.int().nonnegative(),
  run: z.int().positive(),
  status: PageStatus,
  finalUrl: z.string().nullable(),
  httpStatus: z.int().nullable(),
  /** Network and DOM settled before the cap. null when not visited. */
  settled: z.boolean().nullable(),
  reason: z.string().nullable(),
  /** Run directory of the visit, relative to the inspection directory. */
  runPath: z.string().nullable(),
  /** Page writes blocked by --strict-readonly during the visit. */
  blockedWrites: z.int().nonnegative(),
  /** BLOCKED (and UNREACHABLE · NETWORK_RESTRICTED) visits: the concrete kind and its evidence. */
  block: BlockInfo.nullable().default(null),
});
export type PageVisit = z.infer<typeof PageVisit>;

/** One raw measurement of a check on one page in one run. */
export const InspectionObservation = z.strictObject({
  /** Stable identity across runs (see `fingerprintOf`). */
  fingerprint: z.string().min(1),
  title: z.string(),
  detail: z.string(),
  severity: Severity,
  /** The resource or message comes from another origin. */
  thirdParty: z.boolean(),
  /** Paths relative to the inspection directory. */
  evidence: z.array(EvidenceRef),
  /** The correct behaviour, as an assertion a spec can check; null if not expressible. */
  assertion: Assertion.nullable(),
});
export type InspectionObservation = z.infer<typeof InspectionObservation>;

export const CheckResult = z.strictObject({
  checkId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  checkVersion: z.string(),
  page: z.string(),
  run: z.int().positive(),
  status: z.enum(["ran", "skipped", "error"]),
  error: z.string().nullable(),
  observations: z.array(InspectionObservation),
});
export type CheckResult = z.infer<typeof CheckResult>;

/**
 * - `VERIFIED`: observed in every run (N of N, fresh contexts).
 * - `INTERMITTENT`: observed in some runs only. Always reported apart.
 */
export const FindingVerdict = z.enum(["VERIFIED", "INTERMITTENT"]);
export type FindingVerdict = z.infer<typeof FindingVerdict>;

export const Finding = z.strictObject({
  id: z.string(),
  checkId: z.string(),
  checkVersion: z.string(),
  severity: Severity,
  fingerprint: z.string(),
  page: z.string(),
  title: z.string(),
  detail: z.string(),
  thirdParty: z.boolean(),
  /** Runs in which it was observed. */
  occurrences: z.array(z.int().positive()),
  verdict: FindingVerdict,
  /** Evidence of the first occurrence. */
  evidence: z.array(EvidenceRef),
  reproduction: z.array(z.string()),
  assertion: Assertion.nullable(),
  /** Compiled Playwright spec (relative path), for VERIFIED findings whose assertion compiles. */
  spec: z.string().nullable(),
  /** Every visit it was observed in had settled. */
  settled: z.boolean(),
});
export type Finding = z.infer<typeof Finding>;

/** A non-GET request made by the page itself (never by the inspection). */
export const PageWrite = z.strictObject({
  method: z.string(),
  url: z.string(),
  status: z.int().nullable(),
  page: z.string(),
  run: z.int().positive(),
  /** Blocked by --strict-readonly. */
  blocked: z.boolean(),
});
export type PageWrite = z.infer<typeof PageWrite>;

/**
 * `ENGINE_ERROR`: the browser could not start on this machine. Nothing was
 * learned about the site; no page is marked UNREACHABLE for it.
 */
/**
 * An issue group: findings that are the same problem to fix (same contrast
 * colours, same component, same message, same request…), across elements and
 * pages. A derived view (see issue-groups.ts): re-derived when a report loads.
 * - `verdict`: VERIFIED only if every finding in it is; INTERMITTENT if none
 *   is; MIXED otherwise. An intermittent observation is never shown as verified.
 * - `contrast.suggestion`: the nearest colour (lightness only) that meets the
 *   required ratio. A suggestion, not verified on the page.
 */
export const IssueGroup = z.strictObject({
  id: z.string().regex(/^G-[0-9a-f]{12}$/),
  key: z.string(),
  checkId: z.string(),
  rule: z.string().nullable(),
  title: z.string(),
  severity: Severity,
  verdict: z.enum(["VERIFIED", "INTERMITTENT", "MIXED"]),
  verified: z.int().nonnegative(),
  intermittent: z.int().nonnegative(),
  elements: z.int().positive(),
  pages: z.array(z.string()),
  /** Finding ids, in report order. */
  findings: z.array(z.string()),
  /** Up to 5 finding ids whose evidence illustrates the group. */
  examples: z.array(z.string()).max(5),
  contrast: z
    .strictObject({
      foreground: z.string(),
      background: z.string(),
      /** Worst measured ratio in the group. */
      ratio: z.number(),
      required: z.number(),
      textSize: z.enum(["normal", "large"]),
      suggestion: z.strictObject({ color: z.string(), ratio: z.number() }).nullable(),
    })
    .nullable(),
});
export type IssueGroup = z.infer<typeof IssueGroup>;

export const InspectionStatus = z.enum(["COMPLETED", "PARTIAL", "BLOCKED", "UNREACHABLE", "TIMEOUT", "ENGINE_ERROR"]);
export type InspectionStatus = z.infer<typeof InspectionStatus>;

const SeverityCounts = z.strictObject({ critical: z.int(), serious: z.int(), moderate: z.int(), minor: z.int(), info: z.int() });

export const InspectionSummary = z.strictObject({
  pagesVisited: z.int().nonnegative(),
  verified: SeverityCounts,
  intermittent: z.int().nonnegative(),
  /** Observations dropped because their page was DEGRADED under --strict-readonly. */
  discardedByPolicy: z.int().nonnegative(),
  pageWrites: z.int().nonnegative(),
});
export type InspectionSummary = z.infer<typeof InspectionSummary>;

export const InspectionReport = z
  .strictObject({
    /** v2 stores the issue groups; v1 reports load and get them derived. */
    schemaVersion: z.enum(["exegezis.inspection-report/v1", "exegezis.inspection-report/v2"]),
    id: z.string(),
    target: z.strictObject({ url: z.string(), origin: z.string() }),
    startedAt: Timestamp,
    finishedAt: Timestamp,
    exegezisVersion: z.string(),
    options: z.strictObject({
      maxPages: z.int().positive(),
      maxDepth: z.int().nonnegative(),
      runs: z.int().positive(),
      pageTimeoutMs: z.int().positive(),
      totalTimeoutMs: z.int().positive(),
      delayMs: z.int().nonnegative(),
      checks: z.array(z.string()),
      strictReadonly: z.boolean(),
      ignoreRobots: z.boolean(),
      /** Whether a storage state was used (its content is never recorded). */
      storageState: z.boolean(),
    }),
    tools: z.strictObject({
      userAgent: z.string(),
      playwright: z.string(),
      /** axe-core version and the rule ids it ran: without them a11y results are not reproducible. */
      axe: z.string().nullable(),
      axeRules: z.array(z.string()),
      checks: z.array(z.strictObject({ id: z.string(), version: z.string() })),
      /** The browser actually used (null: none started, or a report from before this was recorded). */
      browser: z
        .strictObject({ channel: z.enum(["chromium", "chrome", "msedge"]), version: z.string(), system: z.boolean() })
        .nullable()
        .default(null),
    }),
    robots: z.strictObject({ respected: z.boolean(), fetched: z.boolean(), disallow: z.array(z.string()) }),
    totalTimeoutReached: z.boolean(),
    /** Set when the browser could not start on this machine (status ENGINE_ERROR). */
    engineError: EngineErrorInfo.nullable().default(null),
    status: InspectionStatus,
    pages: z.array(PageVisit),
    externalLinks: z.array(z.strictObject({ url: z.string(), from: z.string() })),
    /** Links never visited because they look like logout or destructive actions (GET). */
    skippedForSafety: z.array(z.strictObject({ url: z.string(), from: z.string(), reason: z.string() })).default([]),
    /** Saved access used for this inspection (never its content). */
    access: z
      .strictObject({
        session: z.boolean(),
        httpCredentials: z.boolean(),
        wafToken: z.boolean(),
        /** The trace could not be redacted, so it was not kept. */
        traceDropped: z.boolean(),
      })
      .default({ session: false, httpCredentials: false, wafToken: false, traceDropped: false }),
    pageWrites: z.array(PageWrite),
    checks: z.array(CheckResult),
    findings: z.array(Finding),
    summary: InspectionSummary,
    groups: z.array(IssueGroup).optional(),
  })
  .refine((r) => r.status === deriveInspectionStatus(r.pages, r.totalTimeoutReached, r.engineError !== null), {
    message: "the status must follow from the page visits",
    path: ["status"],
  })
  .refine((r) => findingsMatch(r.findings, deriveFindings(r.checks, r.pages, r.options.runs, r.options.strictReadonly).groups), {
    message: "the findings (occurrences and verdicts) must follow from the recorded observations",
    path: ["findings"],
  })
  .refine((r) => summariesMatch(r.summary, deriveSummary(r.findings, r.pages, r.pageWrites, r.checks, r.options)), {
    message: "the summary must follow from the findings, pages and page writes",
    path: ["summary"],
  })
  .refine((r) => (r.groups === undefined ? r.schemaVersion === "exegezis.inspection-report/v1" : canonicalJson(r.groups) === canonicalJson(deriveIssueGroups(r.findings))), {
    message: "the issue groups must follow from the findings (v2 reports must carry them)",
    path: ["groups"],
  })
  .transform((r) => ({ ...r, groups: r.groups ?? deriveIssueGroups(r.findings) }));
export type InspectionReport = z.output<typeof InspectionReport>;
export type InspectionReportInput = z.input<typeof InspectionReport>;

// ---------------------------------------------------------------------------
// Deterministic rules
// ---------------------------------------------------------------------------

/** URL without fragment; the identity of a page. */
export function normalizePageUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

/** Removes volatile parts (numbers, hex ids, query strings) so the same problem fingerprints the same in every run. */
export function normalizeMessage(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"')]+/g, (u) => u.replace(/\?.*$/, ""))
    .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function fingerprintOf(checkId: string, key: string): string {
  return `${checkId}:${key}`;
}

/**
 * Overall status: ENGINE_ERROR when the browser could not start (nothing is
 * known about the site); otherwise the entry page decides BLOCKED / UNREACHABLE / TIMEOUT;
 * otherwise PARTIAL if the budget ran out or any visit could not complete.
 */
export function deriveInspectionStatus(pages: readonly Pick<PageVisit, "depth" | "run" | "status">[], totalTimeoutReached: boolean, engineError = false): InspectionStatus {
  if (engineError) return "ENGINE_ERROR";
  const entry = pages.find((p) => p.depth === 0 && p.run === 1);
  if (entry === undefined) return "UNREACHABLE";
  if (entry.status === "BLOCKED" || entry.status === "UNREACHABLE" || entry.status === "TIMEOUT") return entry.status;
  const incomplete = pages.some((p) => p.status === "BLOCKED" || p.status === "UNREACHABLE" || p.status === "TIMEOUT");
  return totalTimeoutReached || incomplete ? "PARTIAL" : "COMPLETED";
}

export interface FindingGroup {
  key: string;
  checkId: string;
  page: string;
  fingerprint: string;
  occurrences: number[];
  verdict: FindingVerdict;
  first: InspectionObservation;
  firstRun: number;
}

/**
 * Groups observations by page + check + fingerprint across runs. Only visits
 * the checks may use count; under --strict-readonly a DEGRADED visit's
 * observations are discarded. VERIFIED iff observed in every one of the
 * `runs` runs.
 */
export function deriveFindings(
  checks: readonly CheckResult[],
  pages: readonly Pick<PageVisit, "url" | "run" | "status">[],
  runs: number,
  strictReadonly: boolean,
): { groups: FindingGroup[]; discarded: number } {
  const usable = new Set(
    pages.filter((p) => INSPECTABLE.includes(p.status) && !(strictReadonly && p.status === "DEGRADED")).map((p) => `${p.url}@${p.run}`),
  );
  const groups = new Map<string, FindingGroup>();
  let discarded = 0;
  for (const check of checks) {
    if (check.status !== "ran") continue;
    if (!usable.has(`${check.page}@${check.run}`)) {
      discarded += check.observations.length;
      continue;
    }
    for (const o of check.observations) {
      const key = `${check.page}|${check.checkId}|${o.fingerprint}`;
      const g = groups.get(key);
      if (g === undefined) {
        groups.set(key, { key, checkId: check.checkId, page: check.page, fingerprint: o.fingerprint, occurrences: [check.run], verdict: "INTERMITTENT", first: o, firstRun: check.run });
      } else {
        if (!g.occurrences.includes(check.run)) g.occurrences.push(check.run);
        if (check.run < g.firstRun) {
          g.first = o;
          g.firstRun = check.run;
        }
      }
    }
  }
  for (const g of groups.values()) {
    g.occurrences.sort((a, b) => a - b);
    g.verdict = g.occurrences.length === runs ? "VERIFIED" : "INTERMITTENT";
  }
  return { groups: [...groups.values()], discarded };
}

function findingsMatch(findings: readonly Finding[], groups: readonly FindingGroup[]): boolean {
  if (findings.length !== groups.length) return false;
  const byKey = new Map(groups.map((g) => [g.key, g]));
  return findings.every((f) => {
    const g = byKey.get(`${f.page}|${f.checkId}|${f.fingerprint}`);
    return g !== undefined && g.verdict === f.verdict && g.occurrences.join(",") === f.occurrences.join(",") && g.first.severity === f.severity;
  });
}

export function deriveSummary(
  findings: readonly Pick<Finding, "verdict" | "severity">[],
  pages: readonly PageVisit[],
  pageWrites: readonly unknown[],
  checks: readonly CheckResult[],
  options: { runs: number; strictReadonly: boolean },
): InspectionSummary {
  const verified = { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 };
  for (const f of findings) if (f.verdict === "VERIFIED") verified[f.severity] += 1;
  return {
    pagesVisited: new Set(pages.filter((p) => INSPECTABLE.includes(p.status) || p.status === "BLOCKED").map((p) => p.url)).size,
    verified,
    intermittent: findings.filter((f) => f.verdict === "INTERMITTENT").length,
    discardedByPolicy: deriveFindings(checks, pages, options.runs, options.strictReadonly).discarded,
    pageWrites: pageWrites.length,
  };
}

function summariesMatch(a: InspectionSummary, b: InspectionSummary): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Findings, ordered by verdict, severity, page and fingerprint, with stable ids. */
export function buildFindings(
  groups: readonly FindingGroup[],
  meta: (g: FindingGroup) => { checkVersion: string; reproduction: string[]; spec: string | null; settled: boolean },
): Finding[] {
  const rank = (s: Severity) => SEVERITIES.indexOf(s);
  const ordered = [...groups].sort(
    (a, b) =>
      (a.verdict === b.verdict ? 0 : a.verdict === "VERIFIED" ? -1 : 1) ||
      rank(a.first.severity) - rank(b.first.severity) ||
      a.page.localeCompare(b.page) ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
  return ordered.map((g, i) => {
    const m = meta(g);
    return {
      id: `F-${String(i + 1).padStart(3, "0")}`,
      checkId: g.checkId,
      checkVersion: m.checkVersion,
      severity: g.first.severity,
      fingerprint: g.fingerprint,
      page: g.page,
      title: g.first.title,
      detail: g.first.detail,
      thirdParty: g.first.thirdParty,
      occurrences: g.occurrences,
      verdict: g.verdict,
      evidence: g.first.evidence,
      reproduction: m.reproduction,
      assertion: g.first.assertion,
      spec: m.spec,
      settled: m.settled,
    };
  });
}

// ---------------------------------------------------------------------------
// Adapter artifact: what the browser adapter records about one page
// ---------------------------------------------------------------------------

export const AxeImpact = z.enum(["critical", "serious", "moderate", "minor"]);

/** `inspection.json`, written by the browser adapter in inspection mode. */
export const PageInspectionFile = z.strictObject({
  schemaVersion: z.literal("exegezis.page-inspection/v1"),
  url: z.string(),
  settled: z.strictObject({ network: z.boolean(), dom: z.boolean() }),
  meta: z.strictObject({
    title: z.string(),
    lang: z.string().nullable(),
    viewport: z.string().nullable(),
    h1Count: z.int().nonnegative(),
    protocol: z.string(),
  }),
  /** Every a[href] (resolved), http(s) only. */
  links: z.array(z.strictObject({ href: z.string(), text: z.string() })),
  axe: z
    .strictObject({
      version: z.string(),
      /** Ids of every rule axe ran on the page. */
      rules: z.array(z.string()),
      violations: z.array(
        z.strictObject({
          id: z.string(),
          impact: AxeImpact.nullable(),
          help: z.string(),
          helpUrl: z.string(),
          nodes: z.array(z.strictObject({ selector: z.string(), html: z.string(), summary: z.string() })),
        }),
      ),
    })
    .nullable(),
  axeError: z.string().nullable(),
  /** Screenshot with the violating nodes outlined (path relative to the run). */
  highlight: z.string().nullable(),
  /** Deterministic signs of anti-bot, CAPTCHA or login walls. Recorded, never acted upon. */
  blockSignals: z.strictObject({
    markers: z.array(z.string()),
    passwordField: z.boolean(),
    /** Visible password field, and how much the page is more than a login form. */
    login: z
      .strictObject({ visiblePassword: z.boolean(), wordsOutsideForms: z.int().nonnegative(), mainContent: z.boolean() })
      .default({ visiblePassword: false, wordsOutsideForms: 0, mainContent: false }),
    /** A cookie/consent dialog: vendor (if known), share of the viewport it covers, scroll locked. */
    consent: z.strictObject({ vendor: z.string().nullable(), coverage: z.number(), scrollLocked: z.boolean() }).nullable().default(null),
    /** Names (never values) of the cookies the context holds. */
    cookieNames: z.array(z.string()).default([]),
  }),
  /** Page writes blocked by --strict-readonly. */
  blockedWrites: z.array(z.strictObject({ method: z.string(), url: z.string() })),
});
export type PageInspectionFile = z.infer<typeof PageInspectionFile>;
