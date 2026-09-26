import type { PageInspectionFile } from "@exegezis/core";
import { describe, expect, it } from "vitest";
import { classifyVisit, isLoginUrl, retryAfter } from "../src/classify.js";
import { evidence } from "./evidence.js";

/*
 * Block kinds and their detection order (docs/09-access.md §1):
 * HTTP_AUTH → BOT_CHALLENGE → SESSION_EXPIRED → LOGIN_WALL → CONSENT_WALL →
 * RATE_LIMITED → FORBIDDEN. NETWORK_RESTRICTED qualifies UNREACHABLE.
 */
type Signals = PageInspectionFile["blockSignals"];
const sig = (patch: Partial<Signals> = {}): Signals => ({
  markers: [],
  passwordField: false,
  login: { visiblePassword: false, wordsOutsideForms: 200, mainContent: true },
  consent: null,
  cookieNames: [],
  ...patch,
});
const LOGIN_FORM_ONLY = { visiblePassword: true, wordsOutsideForms: 12, mainContent: false };

interface Doc {
  status: number;
  url?: string;
  headers?: Record<string, string>;
}
function classify(docs: Doc[], signals: Partial<Signals> = {}, opts: { requested?: string; sessionUsed?: boolean; navigationError?: string } = {}) {
  const e = evidence({
    exchanges: docs.map((d) => ({ url: d.url ?? "https://site.test/account", status: d.status, isNavigation: true, resourceType: "document", ...(d.headers === undefined ? {} : { responseHeaders: d.headers }) })),
    inspection: { blockSignals: sig(signals) },
  });
  return classifyVisit({
    navigationError: opts.navigationError ?? null,
    network: e.network,
    inspection: e.inspection,
    requestedUrl: opts.requested ?? "https://site.test/account",
    strictReadonly: false,
    sessionUsed: opts.sessionUsed ?? false,
  });
}
const kind = (c: ReturnType<typeof classify>) => (c.status === "BLOCKED" || c.status === "UNREACHABLE" ? (c.block?.kind ?? null) : null);

describe("each block kind is detected with its evidence", () => {
  it("HTTP_AUTH: 401 with WWW-Authenticate Basic/Digest", () => {
    const c = classify([{ status: 401, headers: { "WWW-Authenticate": 'Basic realm="staff"' } }]);
    expect(c).toMatchObject({ status: "BLOCKED", block: { kind: "HTTP_AUTH", evidence: { httpStatus: 401, headers: { "www-authenticate": 'Basic realm="staff"' } } } });
  });

  it("BOT_CHALLENGE: DOM markers, cf-mitigated, or a challenge status with signals; cookie names as evidence only", () => {
    expect(kind(classify([{ status: 200 }], { markers: ["turnstile iframe"] }))).toBe("BOT_CHALLENGE");
    expect(kind(classify([{ status: 403, headers: { "cf-mitigated": "challenge" } }]))).toBe("BOT_CHALLENGE");
    expect(kind(classify([{ status: 403, headers: { server: "cloudflare" } }], { cookieNames: ["__cf_bm", "sessionid"] }))).toBe("BOT_CHALLENGE");
    const c = classify([{ status: 403, headers: { "x-datadome": "protected" } }]);
    expect(c.block).toMatchObject({ kind: "BOT_CHALLENGE", evidence: { headers: { "x-datadome": "present" } } });
    // A normal Cloudflare site with its __cf_bm cookie and a 200 is not a challenge.
    expect(classify([{ status: 200, headers: { server: "cloudflare" } }], { cookieNames: ["__cf_bm"] }).status).toBe("OK");
  });

  it("CONSENT_WALL: a known consent manager covering ≥ 30 %, or a generic one covering ≥ 50 % that locks scrolling", () => {
    expect(kind(classify([{ status: 200 }], { consent: { vendor: "OneTrust", coverage: 0.35, scrollLocked: false } }))).toBe("CONSENT_WALL");
    expect(kind(classify([{ status: 200 }], { consent: { vendor: null, coverage: 0.8, scrollLocked: true } }))).toBe("CONSENT_WALL");
    // A small cookie bar at the bottom does not block anything.
    expect(classify([{ status: 200 }], { consent: { vendor: null, coverage: 0.12, scrollLocked: false } }).status).toBe("OK");
  });

  it("RATE_LIMITED: 429, or 503 with Retry-After, keeping how long to wait", () => {
    expect(classify([{ status: 429, headers: { "Retry-After": "7" } }]).block).toMatchObject({ kind: "RATE_LIMITED", retryAfterSeconds: 7 });
    expect(kind(classify([{ status: 503, headers: { "retry-after": "30" } }]))).toBe("RATE_LIMITED");
    expect(classify([{ status: 503 }]).status).toBe("HTTP_ERROR");
    expect(retryAfter(new Date(Date.UTC(2026, 0, 1, 0, 0, 10)).toUTCString(), Date.UTC(2026, 0, 1, 0, 0, 0))).toBe(10);
  });

  it("FORBIDDEN: 403 without challenge signals, and 451", () => {
    expect(classify([{ status: 403 }]).block).toMatchObject({ kind: "FORBIDDEN", evidence: { httpStatus: 403 } });
    expect(kind(classify([{ status: 451 }]))).toBe("FORBIDDEN");
  });

  it("NETWORK_RESTRICTED is a kind of UNREACHABLE, not a block of the site; a dead port stays plain UNREACHABLE", () => {
    const dns = classify([], {}, { requested: "https://intranet.example.com/", navigationError: "page.goto: net::ERR_NAME_NOT_RESOLVED at https://intranet.example.com/" });
    expect(dns).toMatchObject({ status: "UNREACHABLE", block: { kind: "NETWORK_RESTRICTED" } });
    expect(classify([], {}, { requested: "http://10.0.0.5/", navigationError: "page.goto: net::ERR_CONNECTION_TIMED_OUT at http://10.0.0.5/" }).block?.kind).toBe("NETWORK_RESTRICTED");
    expect(classify([], {}, { requested: "http://127.0.0.1:1/", navigationError: "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/" })).toMatchObject({ status: "UNREACHABLE", block: null });
  });
});

describe("LOGIN_WALL: only a real wall, never a page that merely has a login box", () => {
  it("(1) a non-login URL that ends on a login route is a wall", () => {
    const c = classify([{ status: 302 }, { status: 200, url: "https://site.test/sign-in?next=/prayer" }], {}, { requested: "https://site.test/prayer" });
    expect(c.block).toMatchObject({ kind: "LOGIN_WALL", evidence: { finalUrl: "https://site.test/sign-in?next=/prayer" } });
  });

  it("(2) the requested content is replaced by a login form is a wall", () => {
    expect(kind(classify([{ status: 200 }], { passwordField: true, login: LOGIN_FORM_ONLY }))).toBe("LOGIN_WALL");
  });

  it("a login box in the header next to visible content is NOT a wall", () => {
    const c = classify([{ status: 200 }], { passwordField: true, login: { visiblePassword: true, wordsOutsideForms: 450, mainContent: true } });
    expect(c).toMatchObject({ status: "OK", block: null });
  });

  it("inspecting the login URL itself is NOT a wall: it is inspected like any page", () => {
    const c = classify([{ status: 200, url: "https://site.test/sign-in" }], { passwordField: true, login: LOGIN_FORM_ONLY }, { requested: "https://site.test/sign-in" });
    expect(c).toMatchObject({ status: "OK", block: null });
    expect(isLoginUrl("https://site.test/sign-in")).toBe(true);
    expect(isLoginUrl("https://site.test/signing-up-for-news")).toBe(false);
  });

  it("a 401 without WWW-Authenticate is the application's login wall", () => {
    expect(kind(classify([{ status: 401 }]))).toBe("LOGIN_WALL");
  });

  it("with a saved session, the same wall is SESSION_EXPIRED", () => {
    const c = classify([{ status: 302 }, { status: 200, url: "https://site.test/login" }], {}, { sessionUsed: true });
    expect(c.block?.kind).toBe("SESSION_EXPIRED");
  });
});

describe("detection order: HTTP_AUTH → BOT_CHALLENGE → SESSION_EXPIRED → LOGIN_WALL → CONSENT_WALL → RATE_LIMITED → FORBIDDEN", () => {
  it("each pair resolves to the earlier kind", () => {
    const basic = { "www-authenticate": "Basic" };
    // HTTP_AUTH before BOT_CHALLENGE
    expect(kind(classify([{ status: 401, headers: basic }], { markers: ["turnstile iframe"] }))).toBe("HTTP_AUTH");
    // BOT_CHALLENGE before SESSION_EXPIRED / LOGIN_WALL
    expect(kind(classify([{ status: 200 }], { markers: [".cf-turnstile"], passwordField: true, login: LOGIN_FORM_ONLY }, { sessionUsed: true }))).toBe("BOT_CHALLENGE");
    // SESSION_EXPIRED before LOGIN_WALL (same page, with and without a session)
    expect(kind(classify([{ status: 200 }], { login: LOGIN_FORM_ONLY }, { sessionUsed: true }))).toBe("SESSION_EXPIRED");
    // LOGIN_WALL before CONSENT_WALL
    expect(kind(classify([{ status: 200 }], { login: LOGIN_FORM_ONLY, consent: { vendor: "Cookiebot", coverage: 0.5, scrollLocked: true } }))).toBe("LOGIN_WALL");
    // CONSENT_WALL before RATE_LIMITED
    expect(kind(classify([{ status: 429 }], { consent: { vendor: "Didomi", coverage: 0.6, scrollLocked: true } }))).toBe("CONSENT_WALL");
    // RATE_LIMITED before FORBIDDEN: a 429 is never read as a 403-like refusal
    expect(kind(classify([{ status: 429 }]))).toBe("RATE_LIMITED");
    expect(kind(classify([{ status: 403 }]))).toBe("FORBIDDEN");
  });
});
