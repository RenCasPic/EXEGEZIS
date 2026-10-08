import { Assertion } from "@exegezis/core";
import { describe, expect, it } from "vitest";
import { a11y, brokenLinks, CHECKS, consoleErrors, failedRequests, jsExceptions, mixedContent, selectChecks, seoBasics, stableFragment } from "../src/index.js";
import { evidence } from "./evidence.js";

/** Every observation's assertion must be a valid core assertion (it becomes a spec). */
function assertionsValid(observations: { assertion: unknown }[]): boolean {
  return observations.every((o) => o.assertion === null || Assertion.safeParse(o.assertion).success);
}

describe("registry", () => {
  it("every check has an id, a semantic version and a severity; ids are unique", () => {
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
    for (const c of CHECKS) {
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
      expect(c.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(() => selectChecks(["nope"])).toThrow(/unknown check/);
    expect(selectChecks(["a11y"]).map((c) => c.id)).toEqual(["a11y"]);
  });
  it("keeps the stable part of a message for assertions", () => {
    expect(stableFragment("Failed to fetch order 1234 from shard 7")).toBe("Failed to fetch order");
    expect(stableFragment("boom 42")).toBe("boom 42");
  });
});

describe("js-exceptions", () => {
  it("reports each uncaught exception, with a page_error assertion", () => {
    const out = jsExceptions.run(evidence({ pageErrors: [{ name: "ReferenceError", message: "lab is not defined" }] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "serious", thirdParty: false, assertion: { kind: "page_error", contains: "lab is not defined" } });
    expect(assertionsValid(out)).toBe(true);
  });
  it("fingerprints ignore volatile numbers", () => {
    const a = jsExceptions.run(evidence({ pageErrors: [{ name: "Error", message: "request 1 failed" }] }))[0];
    const b = jsExceptions.run(evidence({ pageErrors: [{ name: "Error", message: "request 2 failed" }] }))[0];
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });
});

describe("console-errors", () => {
  it("reports console errors but leaves network and mixed-content lines to their checks", () => {
    const out = consoleErrors.run(
      evidence({
        messages: [
          { text: "Inventory service unavailable" },
          { text: "Failed to load resource: the server responded with a status of 500 ()" },
          { text: "Mixed Content: The page at 'https://a' ..." },
          { text: "just a warning", level: "warning" },
          { text: "tracker broke", location: { url: "https://cdn.other.test/t.js", line: 1, column: 1 } },
        ],
      }),
    );
    expect(out.map((o) => [o.title, o.severity, o.thirdParty])).toEqual([
      ["Console error: Inventory service unavailable", "moderate", false],
      ["Console error: tracker broke", "minor", true],
    ]);
    expect(assertionsValid(out)).toBe(true);
  });

  it("another site's iframe (a cookie banner, a chat) and markup injected by ads are third parties, reported apart (webscraper.io, automationexercise.com)", () => {
    const node = (selector: string, frameUrl: string | null) => ({ selector, html: "<button>", summary: "Fix", frameUrl });
    const out = a11y.run(
      evidence({
        inspection: {
          axe: {
            version: "4.13.0",
            rules: ["button-name"],
            violations: [
              {
                id: "button-name",
                impact: "critical",
                help: "Buttons must have discernible text",
                helpUrl: "https://dequeuniversity.com/rules/axe/4.13/button-name",
                nodes: [
                  node("iframe[data-cy=\"FrameComponent\"] button", "https://beacon-v2.helpscout.net/frame"),
                  node("iframe#same button", "https://site.test/widget"),
                  node(".google-anno-sc > span", null),
                  node("#menu-toggle", null),
                ],
              },
            ],
          },
          highlight: null,
        },
      }),
    );
    expect(out.map((o) => o.thirdParty)).toEqual([true, false, true, false]);
  });
});

describe("failed-requests", () => {
  it("reports 4xx/5xx and network failures, not policy blocks, aborts or linked documents", () => {
    const out = failedRequests.run(
      evidence({
        exchanges: [
          { url: "https://site.test/api/fail", status: 500 },
          { url: "https://site.test/api/missing", status: 404 },
          { url: "https://site.test/api/down", failure: "net::ERR_CONNECTION_REFUSED" },
          { url: "https://site.test/api/ok", status: 200 },
          { method: "POST", url: "https://site.test/api/track", failure: "net::ERR_BLOCKED_BY_CLIENT (EXEGEZIS --strict-readonly)" },
          { url: "https://site.test/img.png", failure: "net::ERR_ABORTED" },
          { url: "https://cdn.other.test/x.js", status: 503 },
        ],
      }),
    );
    expect(out.map((o) => [o.title, o.severity])).toEqual([
      ["GET /api/fail → 500", "serious"],
      ["GET /api/missing → 404", "moderate"],
      ["GET /api/down → ERR_CONNECTION_REFUSED", "serious"],
      ["GET /x.js → 503", "minor"],
    ]);
    expect(out[0]?.assertion).toEqual({ kind: "request", request: { method: "GET", url: "/api/fail" }, expected: "ok" });
    expect(assertionsValid(out)).toBe(true);
  });
  it("counts the entry page's own document, never a linked page's", () => {
    const doc = { url: "https://site.test/p", status: 500, isNavigation: true, resourceType: "document" };
    expect(failedRequests.run(evidence({ page: "https://site.test/p", depth: 0, exchanges: [doc] }))).toHaveLength(1);
    expect(failedRequests.run(evidence({ page: "https://site.test/p", depth: 1, exchanges: [doc] }))).toHaveLength(0);
  });
});

describe("broken-links", () => {
  it("reports checked internal links answering >= 400 or unreachable, never unchecked ones", () => {
    const out = brokenLinks.run(
      evidence({
        links: [
          { url: "https://site.test/old", status: 404, error: null, checked: true },
          { url: "https://site.test/ok", status: 200, error: null, checked: true },
          { url: "https://site.test/private", status: null, error: null, checked: false },
          { url: "https://site.test/down", status: null, error: "connect ECONNREFUSED", checked: true },
        ],
      }),
    );
    expect(out.map((o) => o.title)).toEqual(["Broken link to /old (404)", "Broken link to /down (connect ECONNREFUSED)"]);
    expect(out[0]?.assertion).toEqual({ kind: "link", url: "/old", expected: "ok" });
    expect(assertionsValid(out)).toBe(true);
  });
});

describe("a11y", () => {
  it("reports each rule + node, with axe's impact as severity", () => {
    const out = a11y.run(
      evidence({
        inspection: {
          axe: {
            version: "4.13.0",
            rules: ["image-alt", "label"],
            violations: [
              {
                id: "image-alt",
                impact: "critical",
                help: "Images must have alternative text",
                helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
                nodes: [
                  { selector: "#hero", html: "<img id=hero>", summary: "Fix: add alt", frameUrl: null },
                  { selector: "#logo", html: "<img id=logo>", summary: "Fix: add alt", frameUrl: null },
                ],
              },
            ],
          },
          highlight: "screenshots/axe-highlight.png",
        },
      }),
    );
    expect(out.map((o) => [o.fingerprint, o.severity])).toEqual([
      ["a11y:image-alt #hero", "critical"],
      ["a11y:image-alt #logo", "critical"],
    ]);
    expect(out[0]?.assertion).toEqual({ kind: "a11y", rule: "image-alt", selector: "#hero", expected: "no_violation" });
    expect(out[0]?.evidence[0]).toMatchObject({ kind: "screenshot", path: "pages/run-1/R/screenshots/axe-highlight.png" });
    expect(assertionsValid(out)).toBe(true);
  });
});

describe("mixed-content", () => {
  const report = "Mixed Content: The page at 'https://site.test/' was loaded over HTTPS, but requested an insecure script 'http://site.test:8080/insecure.js'. This request has been blocked; the content must be served over HTTPS.";
  it("reports blocked and allowed insecure resources on HTTPS pages only", () => {
    const out = mixedContent.run(evidence({ messages: [{ text: report }], exchanges: [{ url: "http://img.site.test/a.png", status: 200, resourceType: "image" }] }));
    expect(out.map((o) => [o.title, o.severity])).toEqual([
      ["Mixed content (blocked): http://site.test:8080/insecure.js", "serious"],
      ["Mixed content: http://img.site.test/a.png", "moderate"],
    ]);
    expect(mixedContent.run(evidence({ page: "http://site.test/", messages: [{ text: report }] }))).toEqual([]);
    expect(assertionsValid(out)).toBe(true);
  });
});

describe("seo-basics", () => {
  it("is informational and silent on a complete page", () => {
    expect(seoBasics.run(evidence({}))).toEqual([]);
    const out = seoBasics.run(evidence({ inspection: { meta: { title: "", lang: null, viewport: null, h1Count: 2, protocol: "https:", cspMeta: null, referrerMeta: null } } }));
    expect(out.map((o) => o.fingerprint)).toEqual(["seo-basics:title", "seo-basics:lang", "seo-basics:viewport", "seo-basics:h1-many"]);
    expect(out.every((o) => o.severity === "info")).toBe(true);
    expect(assertionsValid(out)).toBe(true);
  });
});
