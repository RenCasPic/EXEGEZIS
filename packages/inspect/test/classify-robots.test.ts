import { describe, expect, it } from "vitest";
import type { PageInspectionFile } from "@exegezis/core";
import { classifyVisit, isAllowed, parseRobots } from "../src/index.js";
import { evidence } from "./evidence.js";

/** Block signals of a normal content page, with overrides. */
const sig = (patch: Partial<PageInspectionFile["blockSignals"]>): PageInspectionFile["blockSignals"] => ({
  markers: [],
  passwordField: false,
  login: { visiblePassword: false, wordsOutsideForms: 200, mainContent: true, otherForms: 0 },
  consent: null,
  cookieNames: [],
  ...patch,
});
const doc = (status: number, url = "https://site.test/") => ({ url, status, isNavigation: true, resourceType: "document" });
const facts = (patch: Parameters<typeof evidence>[0], navigationError: string | null = null, strictReadonly = false) => {
  const e = evidence(patch);
  return { navigationError, network: e.network, inspection: e.inspection, requestedUrl: e.page, strictReadonly };
};

describe("classifyVisit", () => {
  it("OK and HTTP_ERROR from the document status", () => {
    expect(classifyVisit(facts({ exchanges: [doc(200)] })).status).toBe("OK");
    expect(classifyVisit(facts({ exchanges: [doc(500)] }))).toMatchObject({ status: "HTTP_ERROR", httpStatus: 500 });
  });
  it("UNREACHABLE for DNS / TLS / connection errors and TIMEOUT for timeouts: states, never findings", () => {
    expect(classifyVisit(facts({}, "page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.test/")).status).toBe("UNREACHABLE");
    expect(classifyVisit(facts({}, "page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://self.test/")).status).toBe("UNREACHABLE");
    expect(classifyVisit(facts({}, "page.goto: Timeout 30000ms exceeded.")).status).toBe("TIMEOUT");
  });
  it("BLOCKED on CAPTCHA widgets, challenge pages, 451 and login walls; never bypassed", () => {
    expect(classifyVisit(facts({ exchanges: [doc(200)], inspection: { blockSignals: sig({ markers: ["turnstile iframe"], passwordField: false, login: { visiblePassword: false, wordsOutsideForms: 6, mainContent: false, otherForms: 0 } }) } })).status).toBe("BLOCKED");
    expect(classifyVisit(facts({ exchanges: [doc(403)], inspection: { blockSignals: sig({ markers: ["text: Verify you are human"], passwordField: false }) } })).status).toBe("BLOCKED");
    expect(classifyVisit(facts({ exchanges: [doc(451)] })).status).toBe("BLOCKED");
    const login = facts({ exchanges: [doc(302), doc(200, "https://site.test/login?next=/account")], inspection: { blockSignals: sig({ markers: [], passwordField: true }) } });
    expect(classifyVisit({ ...login, requestedUrl: "https://site.test/account" }).status).toBe("BLOCKED");
  });
  it("does not call a page blocked because its text says 'access denied' with a 200", () => {
    expect(classifyVisit(facts({ exchanges: [doc(200)], inspection: { blockSignals: sig({ markers: ["text: Access denied"], passwordField: false }) } })).status).toBe("OK");
  });
  it("DEGRADED only under --strict-readonly with blocked writes", () => {
    const withBlocked = { exchanges: [doc(200)], inspection: { blockedWrites: [{ method: "POST", url: "https://site.test/api/track" }] } };
    expect(classifyVisit(facts(withBlocked, null, true)).status).toBe("DEGRADED");
    expect(classifyVisit(facts(withBlocked, null, false)).status).toBe("OK");
  });
});

describe("robots.txt", () => {
  const rules = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/\nAllow: /private/ok\nDisallow: /*.pdf$\n");
  it("applies the * group, longest match wins, Allow wins ties, wildcards work", () => {
    expect(isAllowed(rules, "https://s.test/")).toBe(true);
    expect(isAllowed(rules, "https://s.test/private/x")).toBe(false);
    expect(isAllowed(rules, "https://s.test/private/ok")).toBe(true);
    expect(isAllowed(rules, "https://s.test/doc.pdf")).toBe(false);
    expect(isAllowed(rules, "https://s.test/doc.pdf?x")).toBe(true);
  });
  it("prefers a group naming EXEGEZIS over *", () => {
    const named = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: EXEGEZIS\nDisallow: /admin\n");
    expect(isAllowed(named, "https://s.test/page")).toBe(true);
    expect(isAllowed(named, "https://s.test/admin")).toBe(false);
  });
  it("staging sites often disallow everything", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow: /\n"), "https://s.test/any")).toBe(false);
  });
});
