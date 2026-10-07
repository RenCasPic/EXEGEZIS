import { z } from "zod";
import { Assertion } from "./assertion.js";
import { EngineErrorInfo } from "../engine.js";
import { canonicalJson } from "../hash.js";
import { deriveIssueGroups, groupsConsistent } from "../issue-groups.js";
import { EngineMessage } from "../messages.js";
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
  /** What was seen, in one line (English, for logs and older readers). */
  detail: z.string(),
  /** The same, as a code and parameters (docs/11-i18n.md). Absent in older reports. */
  message: EngineMessage.optional(),
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

/**
 * The device a page is visited as. desktop 1280×800; mobile 390×844, touch,
 * a phone's user agent; tablet 820×1180, touch. Reports from before devices
 * existed are desktop.
 */
export const Device = z.enum(["desktop", "mobile", "tablet"]);
export type Device = z.infer<typeof Device>;
export const DEVICES: readonly Device[] = Device.options;

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
  /** The reason as a code and parameters. Absent in older reports. */
  reasonMessage: EngineMessage.optional(),
  /** Run directory of the visit, relative to the inspection directory. */
  runPath: z.string().nullable(),
  /** Page writes blocked by --strict-readonly during the visit. */
  blockedWrites: z.int().nonnegative(),
  /** BLOCKED (and UNREACHABLE · NETWORK_RESTRICTED) visits: the concrete kind and its evidence. */
  block: BlockInfo.nullable().default(null),
  device: Device.default("desktop"),
  /** Lab measurements of the visit (performance). null when not measured (or reports from before). */
  metrics: z.lazy(() => PageMetrics).nullable().default(null),
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
  device: Device.default("desktop"),
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
  /** Runs in which it was observed (on the device where it was verified, or seen most). */
  occurrences: z.array(z.int().positive()),
  /** VERIFIED if it is on at least one device (see `devices`). */
  verdict: FindingVerdict,
  /**
   * Per device inspected: the runs it was observed in and its verdict there —
   * what says «only on mobile», «only on desktop» or «on both». Empty in
   * reports from before devices existed.
   */
  devices: z.array(z.strictObject({ device: Device, occurrences: z.array(z.int().positive()), verdict: FindingVerdict })).default([]),
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
  device: Device.default("desktop"),
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
  /** Small touch targets (mobile-tap-targets): what they are, where, and their measured size. */
  tapTarget: z
    .strictObject({
      kind: z.enum(["link", "button", "field", "element"]),
      place: z.enum(["menu", "header", "footer", "page"]),
      /** Measured size in CSS px; null for a side that already reaches 24 px. */
      width: z.int().nullable(),
      height: z.int().nullable(),
      /** Padding to add on each side to reach 24×24 px. */
      padding: z.strictObject({ x: z.int().nonnegative(), y: z.int().nonnegative() }),
    })
    .nullable()
    .default(null),
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
      /** The devices every page was visited as (each with all its runs). */
      devices: z.array(Device).min(1).default(["desktop"]),
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
    /** RATE_LIMITED answers that were waited out (Retry-After or backoff) before continuing. */
    rateLimit: z.strictObject({ retries: z.int().nonnegative(), waitedSeconds: z.number().nonnegative() }).default({ retries: 0, waitedSeconds: 0 }),
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
  // The stored groups must be an honest grouping of the findings. How findings
  // are grouped may have improved since (they are re-derived below), so a
  // report written before a better grouping still loads, grouped the current way.
  .refine((r) => (r.groups === undefined ? r.schemaVersion === "exegezis.inspection-report/v1" : groupsConsistent(r.groups, r.findings)), {
    message: "the issue groups must follow from the findings (v2 reports must carry them)",
    path: ["groups"],
  })
  .transform((r) => ({ ...r, groups: deriveIssueGroups(r.findings) }));
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
    // A session id in the path (Java's ;jsessionid=…) is not part of the page's address.
    u.pathname = u.pathname.replace(/;jsessionid=[^/]*/gi, "");
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
  /** The device of the first observation. */
  firstDevice: Device;
  /** Per device: runs observed and verdict there, in DEVICES order. */
  devices: { device: Device; occurrences: number[]; verdict: FindingVerdict }[];
}

/**
 * Groups observations by page + check + fingerprint across runs and devices.
 * Only visits the checks may use count; under --strict-readonly a DEGRADED
 * visit's observations are discarded. On each device: VERIFIED iff observed
 * in every one of the `runs` runs. Overall: VERIFIED if it is on at least one
 * device; its occurrences are those of the first such device (or of the
 * device where it was seen most).
 */
export function deriveFindings(
  // Without a device (reports and data from before devices existed): desktop, as the schema loads them.
  checks: readonly (Omit<CheckResult, "device"> & { device?: Device })[],
  pages: readonly (Pick<PageVisit, "url" | "run" | "status"> & { device?: Device })[],
  runs: number,
  strictReadonly: boolean,
): { groups: FindingGroup[]; discarded: number } {
  const usable = new Set(
    pages.filter((p) => INSPECTABLE.includes(p.status) && !(strictReadonly && p.status === "DEGRADED")).map((p) => `${p.url}@${p.run}@${p.device ?? "desktop"}`),
  );
  const groups = new Map<string, FindingGroup & { seen: Map<Device, Set<number>> }>();
  const rank = (d: Device) => DEVICES.indexOf(d);
  let discarded = 0;
  for (const c of checks) {
    const check = { ...c, device: c.device ?? "desktop" };
    if (check.status !== "ran") continue;
    if (!usable.has(`${check.page}@${check.run}@${check.device}`)) {
      discarded += check.observations.length;
      continue;
    }
    for (const o of check.observations) {
      const key = `${check.page}|${check.checkId}|${o.fingerprint}`;
      const g = groups.get(key);
      if (g === undefined) {
        groups.set(key, {
          key,
          checkId: check.checkId,
          page: check.page,
          fingerprint: o.fingerprint,
          occurrences: [],
          verdict: "INTERMITTENT",
          first: o,
          firstRun: check.run,
          firstDevice: check.device,
          devices: [],
          seen: new Map([[check.device, new Set([check.run])]]),
        });
      } else {
        const runsSeen = g.seen.get(check.device) ?? new Set<number>();
        runsSeen.add(check.run);
        g.seen.set(check.device, runsSeen);
        if (rank(check.device) < rank(g.firstDevice) || (check.device === g.firstDevice && check.run < g.firstRun)) {
          g.first = o;
          g.firstRun = check.run;
          g.firstDevice = check.device;
        }
      }
    }
  }
  const out: FindingGroup[] = [];
  for (const { seen, ...g } of groups.values()) {
    g.devices = [...seen.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([device, set]) => {
        const occurrences = [...set].sort((a, b) => a - b);
        return { device, occurrences, verdict: occurrences.length === runs ? "VERIFIED" : "INTERMITTENT" };
      });
    const verified = g.devices.find((d) => d.verdict === "VERIFIED");
    // A measurement bad in only some runs is not a finding (the metrics show it).
    if (verified === undefined && ALL_RUNS_ONLY.has(g.checkId)) continue;
    const most = [...g.devices].sort((a, b) => b.occurrences.length - a.occurrences.length || rank(a.device) - rank(b.device))[0];
    g.verdict = verified === undefined ? "INTERMITTENT" : "VERIFIED";
    g.occurrences = (verified ?? most)?.occurrences ?? [];
    out.push(g);
  }
  return { groups: out, discarded };
}

function findingsMatch(findings: readonly Finding[], groups: readonly FindingGroup[]): boolean {
  if (findings.length !== groups.length) return false;
  const byKey = new Map(groups.map((g) => [g.key, g]));
  return findings.every((f) => {
    const g = byKey.get(`${f.page}|${f.checkId}|${f.fingerprint}`);
    if (g === undefined || g.verdict !== f.verdict || g.occurrences.join(",") !== f.occurrences.join(",") || g.first.severity !== f.severity) return false;
    // Reports from before devices existed carry none (every visit was desktop).
    if (f.devices.length === 0) return g.devices.every((d) => d.device === "desktop");
    return canonicalJson(f.devices) === canonicalJson(g.devices);
  });
}

/** The devices on which a finding is VERIFIED (legacy findings without devices: desktop). */
export function verifiedDevices(f: Pick<Finding, "devices" | "verdict">): Device[] {
  if (f.devices.length === 0) return f.verdict === "VERIFIED" ? ["desktop"] : [];
  return f.devices.filter((d) => d.verdict === "VERIFIED").map((d) => d.device);
}

/**
 * Where something is verified, for «only on mobile», «only on desktop» or
 * «on both»: "all" when on every device inspected, else the devices (in
 * DEVICES order); null when on none, or when only one device was inspected.
 */
export function deviceScope(findings: readonly Pick<Finding, "devices" | "verdict">[], inspected: readonly Device[]): "all" | Device[] | null {
  if (inspected.length < 2) return null;
  const on = new Set(findings.flatMap(verifiedDevices));
  if (on.size === 0) return null;
  if (inspected.every((d) => on.has(d))) return "all";
  return DEVICES.filter((d) => on.has(d));
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
      devices: g.devices,
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

export const PageLayout = z.strictObject({
  viewport: z.strictObject({ width: z.number(), height: z.number() }),
  scrollWidth: z.number(),
  /** The outermost elements that stick out sideways, not clipped by a scrolling container. */
  overflowing: z.array(z.strictObject({ selector: z.string(), right: z.number() })),
  /** Touch targets smaller than 24×24 CSS px (WCAG 2.2, 2.5.8), links inside text exempt. */
  smallTargets: z.array(z.strictObject({ selector: z.string(), width: z.number(), height: z.number(), text: z.string() })),
  /** Visible text under 12 px. */
  smallText: z.strictObject({ count: z.int().nonnegative(), samples: z.array(z.strictObject({ selector: z.string(), fontSize: z.number(), text: z.string() })) }),
  metaViewport: z.strictObject({ content: z.string().nullable(), blocksZoom: z.boolean() }),
  /** Fixed and sticky elements on the screen and the share of it they cover. */
  fixed: z.strictObject({
    coveredShare: z.number(),
    elements: z.array(z.strictObject({ selector: z.string(), position: z.string(), top: z.number(), height: z.number(), share: z.number() })),
  }),
});
export type PageLayout = z.infer<typeof PageLayout>;

/**
 * Lab performance of one visit, measured in the browser (PERF_OBSERVER_SCRIPT
 * + PERF_FACTS_SCRIPT): milliseconds from the start of the navigation. A
 * metric the browser did not report is null.
 */
export const PagePerformance = z.strictObject({
  fcpMs: z.number().nonnegative().nullable(),
  lcpMs: z.number().nonnegative().nullable(),
  /** Cumulative Layout Shift: the largest session window, as Core Web Vitals defines it. */
  cls: z.number().nonnegative().nullable(),
  /** Total Blocking Time: the long tasks' time over 50 ms, after the first paint (an approximation of INP in the lab). */
  tbtMs: z.number().nonnegative().nullable(),
  domContentLoadedMs: z.number().nonnegative().nullable(),
  loadMs: z.number().nonnegative().nullable(),
  /** The images shown: their file's size in pixels and the size they are drawn at (CSS px). */
  images: z.array(z.strictObject({ url: z.string(), naturalWidth: z.int().nonnegative(), naturalHeight: z.int().nonnegative(), width: z.number().nonnegative(), height: z.number().nonnegative() })),
  devicePixelRatio: z.number().positive(),
});
export type PagePerformance = z.infer<typeof PagePerformance>;

/** A Set-Cookie header of the site: what it asks the browser for, never the value. */
export const SetCookieFacts = z.strictObject({
  name: z.string(),
  /** The response that set it. */
  url: z.string(),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  /** The SameSite attribute as written (Lax, Strict, None), or null when absent. */
  sameSite: z.string().nullable(),
  /** No Expires nor Max-Age: it ends with the browser session. */
  session: z.boolean(),
});
export type SetCookieFacts = z.infer<typeof SetCookieFacts>;

/** What a page visit measured, kept in the report: the metrics are shown as a median with their range. */
export const PageMetrics = z.strictObject({
  ttfbMs: z.number().nonnegative().nullable(),
  fcpMs: z.number().nonnegative().nullable(),
  lcpMs: z.number().nonnegative().nullable(),
  cls: z.number().nonnegative().nullable(),
  tbtMs: z.number().nonnegative().nullable(),
  loadMs: z.number().nonnegative().nullable(),
  /** Bytes transferred by every request of the visit, and how many requests. */
  bytes: z.int().nonnegative(),
  requests: z.int().nonnegative(),
});
export type PageMetrics = z.infer<typeof PageMetrics>;

/**
 * Checks whose observations are measurements that vary from run to run
 * (lab performance): a finding only when bad in every run (N of N). One
 * slow run is not a problem to fix; the metrics show it anyway.
 */
export const ALL_RUNS_ONLY: ReadonlySet<string> = new Set(["perf-vitals", "slow-response"]);

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
    /** A Content-Security-Policy and a referrer policy set in <meta> tags (they count as the headers would). */
    cspMeta: z.string().nullable().default(null),
    referrerMeta: z.string().nullable().default(null),
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
  /** Layout facts for the mobile checks (LAYOUT_FACTS_SCRIPT). null in files from before they existed. */
  layout: PageLayout.nullable().default(null),
  /** Lab performance of the visit (PERF_FACTS_SCRIPT). null in files from before it existed. */
  performance: PagePerformance.nullable().default(null),
  /** The site's own Set-Cookie headers: names and attributes only, never values. */
  setCookies: z.array(SetCookieFacts).default([]),
});
export type PageInspectionFile = z.infer<typeof PageInspectionFile>;
