import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCompiledSpec } from "@exegezis/compiler-playwright";
import { InspectionReport } from "@exegezis/core";
import { generate } from "selfsigned";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inspectSite, type InspectOptions } from "../src/index.js";

/**
 * `exegezis inspect` end to end against examples/inspect-lab, in real
 * Chromium. The lab's seeded problems are the ground truth. HTTPS uses a
 * self-signed certificate generated here, in memory and in a temp dir:
 * nothing is stored in the repository.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LAB = join(REPO, "examples/inspect-lab");
// Inside the repository so the generated specs resolve @playwright/test and @axe-core/playwright.
const WORK = join(REPO, "packages/inspect/test/.tmp-e2e");

let lab: ChildProcess;
let http: string;
let https: string;
/** The misconfigured site (misconfigured.ts), over HTTPS with a certificate that expires in 10 days, and its CA. */
let misconfigured: string;
let misconfiguredCa: string;

/** The checks the seeded site's ground truth is about (the backend and performance ones have their own site). */
const SEEDED_CHECKS = ["js-exceptions", "console-errors", "failed-requests", "broken-links", "a11y", "mixed-content", "seo-basics"];

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => done(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

async function stats(): Promise<{ writes: Record<string, number>; flakyCalls: number; traps: Record<string, number> }> {
  return (await (await fetch(`${http}__lab/stats`)).json()) as { writes: Record<string, number>; flakyCalls: number; traps: Record<string, number> };
}

let counter = 0;
function run(url: string, options: Partial<InspectOptions> = {}): Promise<InspectionReport> {
  counter += 1;
  const dir = join(WORK, `inspection-${counter}`);
  return inspectSite({ url, dir, id: `test-${counter}`, exegezisVersion: "0.1.0", delayMs: 0, ignoreHTTPSErrors: true, devices: ["desktop"], ...options });
}

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const pems = await generate([{ name: "commonName", value: "127.0.0.1" }], { keySize: 2048 });
  writeFileSync(join(WORK, "key.pem"), pems.private);
  writeFileSync(join(WORK, "cert.pem"), pems.cert);
  // A certificate for 127.0.0.1 that expires in 10 days: the TLS check trusts it (tlsCa) and must warn.
  const expiring = await generate([{ name: "commonName", value: "127.0.0.1" }], {
    keySize: 2048,
    notAfterDate: new Date(Date.now() + 10 * 86_400_000 + 3_600_000),
    extensions: [{ name: "subjectAltName", altNames: [{ type: 7, ip: "127.0.0.1" }] }],
  });
  writeFileSync(join(WORK, "misconfigured-key.pem"), expiring.private);
  writeFileSync(join(WORK, "misconfigured-cert.pem"), expiring.cert);
  misconfiguredCa = expiring.cert;
  const [port, tlsPort, badPort] = [await freePort(), await freePort(), await freePort()];
  http = `http://127.0.0.1:${port}/`;
  https = `https://127.0.0.1:${tlsPort}/`;
  misconfigured = `https://127.0.0.1:${badPort}/`;
  lab = spawn(process.execPath, ["src/server.ts"], {
    cwd: LAB,
    env: {
      ...process.env,
      PORT: String(port),
      HTTPS_PORT: String(tlsPort),
      TLS_KEY_FILE: join(WORK, "key.pem"),
      TLS_CERT_FILE: join(WORK, "cert.pem"),
      MISCONFIG_TLS_PORT: String(badPort),
      MISCONFIG_KEY_FILE: join(WORK, "misconfigured-key.pem"),
      MISCONFIG_CERT_FILE: join(WORK, "misconfigured-cert.pem"),
    },
    stdio: "ignore",
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${http}__lab/health`)).ok) break;
    } catch {
      // not yet
    }
    if (Date.now() > deadline) throw new Error("inspect-lab did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
});

afterAll(() => {
  lab.kill();
  rmSync(WORK, { recursive: true, force: true });
});

describe("the site with seeded problems (HTTPS, 3 runs)", () => {
  let report: InspectionReport;
  beforeAll(async () => {
    report = await run(https, { runs: 3, checks: SEEDED_CHECKS });
  }, 300_000);

  const verified = () => report.findings.filter((f) => f.verdict === "VERIFIED" && f.severity !== "info");

  it("loads as a valid, self-consistent report", () => {
    expect(InspectionReport.safeParse(JSON.parse(JSON.stringify(report))).success).toBe(true);
    expect(report.status).toBe("COMPLETED");
    expect(report.tools).toMatchObject({ userAgent: "EXEGEZIS-Inspector/0.1.0", axe: "4.13.0" });
    expect(report.tools.axeRules).toContain("image-alt");
  });

  it("finds every seeded problem as VERIFIED (3/3)", () => {
    const got = verified().map((f) => `${f.checkId} ${f.title}`);
    expect(got).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^js-exceptions Uncaught ReferenceError: lab is not defined/),
        "console-errors Console error: Inventory service unavailable",
        "failed-requests GET /api/fail → 500",
        "broken-links Broken link to /broken-page (404)",
        expect.stringMatching(/^a11y .*\(image-alt\): #hero/),
        // 127.0.0.1 is a potentially trustworthy origin: Chromium loads (does not block) the insecure script.
        expect.stringMatching(/^mixed-content Mixed content: http:\/\/127\.0\.0\.1:\d+\/insecure\.js/),
      ]),
    );
    expect(verified()).toHaveLength(6);
    expect(verified().every((f) => f.occurrences.join() === "1,2,3" && f.page === https)).toBe(true);
  });

  it("reports the flaky endpoint as INTERMITTENT, apart from the verified ones", () => {
    const intermittent = report.findings.filter((f) => f.verdict === "INTERMITTENT");
    expect(intermittent.map((f) => [f.title, f.occurrences.join()])).toEqual([["GET /api/flaky → 500", "1,3"]]);
    expect(report.summary.intermittent).toBe(1);
  });

  it("keeps evidence for every verified finding and a spec for each one that can be expressed", () => {
    for (const f of verified()) {
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.evidence.some((e) => e.kind === "trace")).toBe(true);
      expect(f.reproduction.length).toBeGreaterThan(1);
      expect(f.spec).toMatch(/^specs\/INSPECT-F-\d{3}\.spec\.ts$/);
    }
    const a11yFinding = verified().find((f) => f.checkId === "a11y");
    expect(a11yFinding?.evidence.find((e) => e.kind === "screenshot")?.path).toMatch(/axe-highlight\.png$/);
  });

  it("stays in the origin, lists external links without visiting them, and respects robots.txt", () => {
    const urls = new Set(report.pages.map((p) => p.url));
    expect(urls).toEqual(new Set([https, `${https}about`, `${https}forms`, `${https}broken-page`, `${https}private/secret`]));
    expect(report.pages.find((p) => p.url === `${https}private/secret`)?.status).toBe("SKIPPED_ROBOTS");
    expect(report.externalLinks).toEqual([{ url: "https://example.org/", from: https }]);
    expect(report.robots).toMatchObject({ respected: true, fetched: true, disallow: ["/private/"] });
  });

  it("the compiled specs run on their own and reproduce the findings", async () => {
    // Over plain HTTP (BASE_URL): the specs are portable; mixed content only exists on HTTPS, so its spec is not run here.
    const runnable = verified().filter((f) => f.spec !== null && f.checkId !== "mixed-content");
    expect(runnable.length).toBe(5);
    const dir = join(WORK, `inspection-1`);
    for (const f of runnable) {
      const specPath = join(dir, f.spec as string);
      const result = await runCompiledSpec({ specPath, steps: [], baseUrl: http, outputDir: join(dir, "spec-results", f.id) });
      expect(result.status, `${f.id} ${f.title}: ${result.message ?? ""}`).toBe("failed");
    }
  }, 300_000);
});

describe("link safety by design: the trap links of /traps/ (docs/07 §4)", () => {
  it("visits and checks only pages: every trap (actions, technical routes, a form, onclick, data-href, nofollow, a download, a redirect to logging out) is called 0 times", async () => {
    // Depth 1: the crawl visits what it may; depth 0: the links are only checked (HEAD first).
    const crawled = await run(`${http}traps/`, { runs: 2, devices: ["desktop", "mobile"], maxDepth: 1, checks: SEEDED_CHECKS });
    const checked = await run(`${http}traps/`, { runs: 2, maxDepth: 0, checks: SEEDED_CHECKS });
    expect((await stats()).traps).toEqual({});
    // The ordinary page was visited; the rest listed as skipped for safety, with why.
    expect(crawled.pages.filter((p) => p.status === "OK").map((p) => p.url)).toContain(`${http}traps/ok`);
    const skipped = new Map(crawled.skippedForSafety.map((s) => [s.url.replace(http, "/"), s.reason]));
    for (const trap of ["/traps/api/deleteAccount", "/traps/account/deleteaccount", "/traps/log-out", "/traps/orders/9/cancel", "/traps/nofollow", "/traps/go"]) expect(skipped.has(trap), trap).toBe(true);
    expect(skipped.get("/traps/go")).toMatch(/^redirects to an address never requested/);
    expect(checked.status).toBe("COMPLETED");
  }, 300_000);
});

describe("the app's error page (found on jesushealingministry.net)", () => {
  it("is a failed visit with its reason, and none of its missing title, h1, lang or viewport becomes a finding", async () => {
    const report = await run(`${http}app-error/`, { runs: 1, devices: ["desktop", "mobile"] });
    expect(report.pages.map((p) => p.status)).toEqual(["UNREACHABLE"]);
    expect(report.pages[0]?.reason).toMatch(/app's error page/);
    expect(report.findings).toEqual([]);
  }, 120_000);
});

describe("another site's iframe (found on webscraper.io)", () => {
  it("its accessibility problems are a third party's, reported apart; the page's own are the page's", async () => {
    const report = await run(`${http}iframes/`, { runs: 1, checks: ["a11y"] });
    const names = report.findings.filter((f) => f.title.includes("(button-name)"));
    expect(names.map((f) => [f.title.replace(/^.*\): /, ""), f.thirdParty]).sort()).toEqual([
      ["#own", false],
      ["iframe button", true],
    ]);
  }, 120_000);
});

describe("a contact form with a CAPTCHA (found on practicetestautomation.com/contact)", () => {
  it("is the form's CAPTCHA, not a bot wall: the page is inspected", async () => {
    const report = await run(`${http}contact-captcha/`, { runs: 1, checks: SEEDED_CHECKS });
    expect(report.pages[0]).toMatchObject({ status: "OK", block: null });
  }, 120_000);
});

describe("a page whose own CSS and scripts hang (found on the-internet.herokuapp.com)", () => {
  it("is inspected as it is instead of a TIMEOUT of the whole site", async () => {
    const report = await run(`${http}slow-assets/`, { runs: 1, pageTimeoutMs: 4000, checks: SEEDED_CHECKS });
    expect(report.status).toBe("COMPLETED");
    expect(report.pages[0]).toMatchObject({ status: "OK", httpStatus: 200 });
  }, 120_000);
});

describe("the healthy site", () => {
  it("has 0 findings, with every check (the backend, site and performance ones too) on desktop and mobile", async () => {
    const report = await run(`${http}healthy/`, { runs: 3, devices: ["desktop", "mobile"] });
    expect(report.status).toBe("COMPLETED");
    expect(report.pages.filter((p) => p.run === 1 && p.device === "desktop").map((p) => p.url).sort()).toEqual([`${http}healthy/`, `${http}healthy/about`]);
    expect(report.findings.map((f) => `${f.checkId} ${f.title}`)).toEqual([]);
    // The site checks ran, once per run, and every page was measured.
    expect(report.checks.filter((c) => c.checkId === "site-config" && c.status === "ran").map((c) => c.run)).toEqual([1, 2, 3]);
    const measured = report.pages.filter((p) => p.status === "OK");
    expect(measured.every((p) => p.metrics !== null && p.metrics.requests > 0 && p.metrics.bytes > 0 && p.metrics.ttfbMs !== null && p.metrics.fcpMs !== null)).toBe(true);
  }, 300_000);
});

describe("the misconfigured site (backend and performance, seen from outside)", () => {
  let report: InspectionReport;
  beforeAll(async () => {
    report = await run(misconfigured, { runs: 3, tlsCa: misconfiguredCa });
  }, 300_000);
  const found = () =>
    report.findings
      .filter((f) => f.verdict === "VERIFIED")
      .map((f) => `${f.checkId} ${f.fingerprint.slice(f.fingerprint.indexOf(":") + 1).replace(misconfigured, "/")}`)
      .sort();

  it("finds each problem, verified in 3 of 3 runs", () => {
    expect(found()).toEqual(
      expect.arrayContaining([
        "security-headers hsts-missing",
        "security-headers csp-missing",
        "security-headers nosniff-missing",
        "security-headers framing-allowed",
        "security-headers referrer-missing",
        "security-headers permissions-missing",
        "cookies not-secure sessionid",
        "cookies not-httponly sessionid",
        "cookies no-samesite sessionid",
        "heavy-resources heavy-image /big.png",
        "heavy-resources legacy-format /big.png",
        "heavy-resources uncompressed /app.js",
        "heavy-resources no-cache /app.js",
        "slow-response ttfb",
        "https cert-expiring",
        "site-config sitemap-url /gone",
        "site-config soft-404",
      ]),
    );
    expect(report.findings.find((f) => f.checkId === "https")?.title).toMatch(/^The HTTPS certificate expires in (9|10) days$/);
    expect(report.findings.find((f) => f.checkId === "slow-response")?.page).toBe(`${misconfigured}slow`);
  });

  it("never stores a cookie's value; the site's probe is saved as evidence", () => {
    expect(JSON.stringify(report)).not.toContain("lab-session-value");
    expect(report.findings.find((f) => f.checkId === "site-config")?.evidence[0]?.path).toBe("site-run-1.json");
  });

  it("the metrics of every visit are kept (a median and range can be shown)", () => {
    const slow = report.pages.filter((p) => p.url === `${misconfigured}slow` && p.status === "OK");
    expect(slow).toHaveLength(3);
    expect(slow.every((p) => (p.metrics?.ttfbMs ?? 0) >= 2400)).toBe(true);
    const home = report.pages.filter((p) => p.url === misconfigured);
    expect(home.every((p) => (p.metrics?.bytes ?? 0) > 420 * 1024)).toBe(true);
  });
});

describe("desktop and mobile (the /devices/ section)", () => {
  let report: InspectionReport;
  beforeAll(async () => {
    report = await run(`${http}devices/`, { runs: 2, devices: ["desktop", "mobile"] });
  }, 300_000);

  const where = (f: InspectionReport["findings"][number]) =>
    f.devices
      .filter((d) => d.verdict === "VERIFIED")
      .map((d) => d.device)
      .join("+");

  it("visits every page as each device, each with all its runs", () => {
    expect(report.options.devices).toEqual(["desktop", "mobile"]);
    const visits = report.pages.filter((p) => p.status === "OK").map((p) => `${p.device} ${p.run} ${p.url.slice(http.length)}`);
    expect(visits.sort()).toEqual(["desktop 1 devices/", "desktop 1 devices/fine", "desktop 2 devices/", "desktop 2 devices/fine", "mobile 1 devices/", "mobile 1 devices/fine", "mobile 2 devices/", "mobile 2 devices/fine"]);
    expect(report.pages.find((p) => p.device === "mobile")?.runPath).toMatch(/^pages\/mobile-run-/);
  });

  it("says whether each finding is only on mobile, only on desktop or on both", () => {
    const verified = report.findings.filter((f) => f.verdict === "VERIFIED" && f.page === `${http}devices/`);
    const byTitle = new Map(verified.map((f) => [f.title, where(f)]));
    expect(byTitle.get("Console error: Shown on every screen")).toBe("desktop+mobile");
    expect(byTitle.get("Console error: Only on wide screens")).toBe("desktop");
    expect(byTitle.get("The page scrolls sideways on a small screen")).toBe("mobile");
  });

  it("finds the mobile problems on a phone and none on the page done right", () => {
    const mobile = report.findings.filter((f) => f.verdict === "VERIFIED" && f.checkId.startsWith("mobile-"));
    const on = (page: string) => mobile.filter((f) => f.page === `${http}${page}`).map((f) => f.checkId);
    expect(new Set(on("devices/"))).toEqual(new Set(["mobile-scroll", "mobile-tap-targets", "mobile-text-size", "mobile-viewport", "mobile-fixed-overlap"]));
    expect(on("devices/fine")).toEqual([]);
    expect(mobile.every((f) => where(f) === "mobile")).toBe(true);
    const tiny = mobile.find((f) => f.checkId === "mobile-tap-targets");
    expect(tiny?.detail).toContain("16×16");
  });
});

describe("issue groups (the /groups/ section: one component on 3 pages, two colour pairs, a varying console error)", () => {
  let first: InspectionReport;
  let second: InspectionReport;
  beforeAll(async () => {
    first = await run(`${http}groups/`, { runs: 3 });
    second = await run(`${http}groups/`, { runs: 3 });
  }, 600_000);

  const contrast = (r: InspectionReport) => r.groups.filter((g) => g.rule === "color-contrast");

  it("the repeated low-contrast card is 1 group with 3 pages, the second colour pair another group", () => {
    const pages = [`${http}groups/`, `${http}groups/a`, `${http}groups/b`].sort();
    const card = contrast(first).find((g) => g.contrast?.foreground === "#9ca3af");
    expect(card).toMatchObject({ verdict: "VERIFIED", elements: 3, pages, contrast: { background: "#ffffff", required: 4.5 } });
    expect(card?.contrast?.suggestion?.ratio).toBeGreaterThanOrEqual(4.5);
    const gold = contrast(first).find((g) => g.contrast?.foreground === "#c4862a");
    expect(gold).toMatchObject({ elements: 1, pages: [`${http}groups/b`] });
    expect(contrast(first)).toHaveLength(2);
  });

  it("the console error with different numbers on each load is 1 group", () => {
    const errors = first.groups.filter((g) => g.checkId === "console-errors");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ verdict: "VERIFIED", elements: 3 });
  });

  it("group ids are the same in two identical inspections", () => {
    expect(first.groups.map((g) => g.id)).toEqual(second.groups.map((g) => g.id));
    expect(first.schemaVersion).toBe("exegezis.inspection-report/v2");
  });
});

describe("a site that blocks", () => {
  it("is BLOCKED with its reason and evidence, and has no findings", async () => {
    const report = await run(`${http}blocked/`, { runs: 3 });
    expect(report.status).toBe("BLOCKED");
    expect(report.pages).toHaveLength(1);
    expect(report.pages[0]).toMatchObject({ status: "BLOCKED", httpStatus: 403 });
    expect(report.pages[0]?.reason).toMatch(/g-recaptcha/);
    expect(report.findings).toEqual([]);
  }, 300_000);
});

describe("read-only", () => {
  it("never starts a non-GET request: forms and buttons untouched, the page's own writes attributed to it", async () => {
    const before = await stats();
    const report = await run(`${http}forms`, { runs: 2, maxPages: 1 });
    const after = await stats();
    const delta = (key: string) => (after.writes[key] ?? 0) - (before.writes[key] ?? 0);
    expect(delta("POST /api/subscribe")).toBe(0);
    expect(delta("POST /api/like")).toBe(0);
    expect(delta("POST /api/track")).toBe(2);
    expect(report.pageWrites).toEqual([
      { method: "POST", url: `${http}api/track`, status: 200, page: `${http}forms`, run: 1, blocked: false, device: "desktop" },
      { method: "POST", url: `${http}api/track`, status: 200, page: `${http}forms`, run: 2, blocked: false, device: "desktop" },
    ]);
    expect(report.summary.pageWrites).toBe(2);
  }, 300_000);

  it("--strict-readonly blocks the page's writes too: the page is DEGRADED and nothing reaches the server", async () => {
    const before = await stats();
    const report = await run(`${http}forms`, { runs: 2, maxPages: 1, strictReadonly: true });
    const after = await stats();
    expect((after.writes["POST /api/track"] ?? 0) - (before.writes["POST /api/track"] ?? 0)).toBe(0);
    expect(report.pages.filter((p) => p.runPath !== null).map((p) => p.status)).toEqual(["DEGRADED", "DEGRADED"]);
    expect(report.pageWrites.every((w) => w.blocked)).toBe(true);
    expect(report.options.strictReadonly).toBe(true);
    expect(report.findings).toEqual([]);
  }, 300_000);
});

describe("unreachable targets", () => {
  it("is UNREACHABLE, not a finding", async () => {
    const report = await run("http://127.0.0.1:1/", { runs: 2 });
    expect(report.status).toBe("UNREACHABLE");
    expect(report.findings).toEqual([]);
  }, 120_000);
});


