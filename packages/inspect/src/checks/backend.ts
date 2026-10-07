import { sameSite } from "@exegezis/adapter-browser";
import { fingerprintOf, normalizePageUrl, type InspectionObservation, type NetworkExchangeEvidence, type Severity } from "@exegezis/core";
import { pageEvidence, type Check, type PageEvidence } from "./types.js";

/*
 * The server seen from outside, page by page: its security headers, the
 * cookies it sets and how long it takes to answer. Pure functions of what
 * the browser recorded for the page's own document (network.json) and the
 * Set-Cookie attributes (inspection.json; never a cookie's value).
 */

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** The page's own document: the last answer of the main frame's navigation, after any redirects. */
export function pageDocument(e: PageEvidence): NetworkExchangeEvidence | null {
  const doc = [...e.network.exchanges]
    .reverse()
    .find((x) => x.request.isNavigation && x.request.mainFrame !== false && x.request.resourceType === "document" && x.response !== undefined && (x.response.status < 300 || x.response.status >= 400));
  if (doc === undefined || !sameSite(host(doc.request.url), host(e.page))) return null;
  return doc;
}

const networkRef = (e: PageEvidence, x: NetworkExchangeEvidence, description: string) => pageEvidence(e, [{ kind: "network", path: `${e.runPath}/network.json`, ref: x.id, description }]);

/** Six months: the shortest max-age HSTS preload lists and most guides accept. */
const HSTS_MIN_SECONDS = 15_552_000;

export const securityHeaders: Check = {
  id: "security-headers",
  version: "1.0.0",
  description: "Security headers of the page's document: HSTS, CSP, X-Content-Type-Options, framing, Referrer-Policy, Permissions-Policy",
  severity: "moderate",
  run(e) {
    const doc = pageDocument(e);
    if (doc?.response === undefined || doc.response.status >= 400) return [];
    const h = Object.fromEntries(Object.entries(doc.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
    const out: InspectionObservation[] = [];
    const add = (rule: string, severity: Severity, title: string, detail: string) =>
      out.push({ fingerprint: fingerprintOf(this.id, rule), title, detail, severity, thirdParty: false, evidence: networkRef(e, doc, "The document's response headers"), assertion: null });
    const https = doc.request.url.startsWith("https:");
    if (https) {
      const hsts = h["strict-transport-security"];
      const maxAge = hsts === undefined ? null : Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts)?.[1] ?? "0");
      if (hsts === undefined) {
        add("hsts-missing", "moderate", "No Strict-Transport-Security header", "Without HSTS a browser may still try the site over plain HTTP first, where the connection can be intercepted. Suggested: Strict-Transport-Security: max-age=31536000; includeSubDomains");
      } else if (maxAge !== null && maxAge < HSTS_MIN_SECONDS) {
        add("hsts-short", "minor", `Strict-Transport-Security lasts only ${maxAge} s`, `The header is «${hsts}»: under 6 months (15552000 s) the protection ends too soon. Suggested: max-age=31536000; includeSubDomains`);
      }
    }
    const csp = h["content-security-policy"];
    const cspMeta = e.inspection.meta.cspMeta;
    if (csp === undefined && cspMeta === null) {
      add(
        "csp-missing",
        "moderate",
        "No Content-Security-Policy",
        `There is no Content-Security-Policy (header or <meta>)${h["content-security-policy-report-only"] === undefined ? "" : "; only a report-only one, which enforces nothing"}: an injected script would run without limits. Suggested: start with Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self' and widen it for what the site uses.`,
      );
    }
    if ((h["x-content-type-options"] ?? "").toLowerCase().trim() !== "nosniff") {
      add("nosniff-missing", "minor", "No X-Content-Type-Options: nosniff", "Without it a browser may guess a file's type and run as a script what was sent as something else. Suggested: X-Content-Type-Options: nosniff");
    }
    const xfo = (h["x-frame-options"] ?? "").toLowerCase();
    const frameAncestors = /frame-ancestors/i.test(csp ?? "");
    if (!["deny", "sameorigin"].includes(xfo.trim()) && !frameAncestors) {
      add("framing-allowed", "moderate", "Any site can show this page in a frame", "There is neither X-Frame-Options (DENY or SAMEORIGIN) nor a CSP frame-ancestors directive, so another site can embed the page and trick people into clicking (clickjacking). Suggested: Content-Security-Policy: frame-ancestors 'self' (and X-Frame-Options: SAMEORIGIN for old browsers).");
    }
    const referrer = (h["referrer-policy"] ?? e.inspection.meta.referrerMeta ?? "").toLowerCase();
    if (referrer === "") {
      add("referrer-missing", "minor", "No Referrer-Policy", "Without a Referrer-Policy the browser's default applies. Suggested: Referrer-Policy: strict-origin-when-cross-origin");
    } else if (/unsafe-url/.test(referrer)) {
      add("referrer-unsafe", "minor", "Referrer-Policy: unsafe-url sends full addresses to other sites", `The policy is «${referrer}»: the full address (with its query) of every page goes to every site it links to, even over HTTP. Suggested: strict-origin-when-cross-origin`);
    }
    if (h["permissions-policy"] === undefined && h["feature-policy"] === undefined) {
      add("permissions-missing", "minor", "No Permissions-Policy", "The page does not say which browser features (camera, microphone, location…) it and its embedded content may use. Suggested, for a site that uses none: Permissions-Policy: camera=(), microphone=(), geolocation=()");
    }
    return out;
  },
};

/** Cookie names that usually hold a session or a login. */
const SESSION_NAME = /sess|sid\b|^sid|auth|token|login|jwt|remember|logged/i;

export const cookies: Check = {
  id: "cookies",
  version: "1.0.0",
  description: "The site's own cookies: Secure on HTTPS, HttpOnly on session cookies, SameSite",
  severity: "moderate",
  run(e) {
    const https = e.page.startsWith("https:");
    const seen = new Map<string, (typeof e.inspection.setCookies)[number]>();
    for (const c of e.inspection.setCookies) if (!seen.has(c.name)) seen.set(c.name, c);
    const out: InspectionObservation[] = [];
    const evidence = pageEvidence(e, [{ kind: "dom", path: `${e.runPath}/inspection.json`, ref: "setCookies", description: "The Set-Cookie headers' attributes (never the values)" }]);
    for (const c of seen.values()) {
      const add = (rule: string, severity: Severity, title: string, detail: string) => out.push({ fingerprint: fingerprintOf(this.id, `${rule} ${c.name}`), title, detail, severity, thirdParty: false, evidence, assertion: null });
      if (https && !c.secure) add("not-secure", "moderate", `Cookie ${c.name} without Secure`, `${c.url} sets ${c.name} without the Secure attribute: on an HTTPS site the browser would also send it over plain HTTP. Suggested: add Secure.`);
      if (SESSION_NAME.test(c.name) && !c.httpOnly) add("not-httponly", "moderate", `Session cookie ${c.name} without HttpOnly`, `${c.name} looks like a session or login cookie and lacks HttpOnly: any script on the page (an injected one too) can read it. Suggested: add HttpOnly.`);
      if (c.sameSite === null) add("no-samesite", "minor", `Cookie ${c.name} without SameSite`, `${c.url} sets ${c.name} without SameSite: browsers apply their own default, which differs between them. Suggested: SameSite=Lax (or Strict; None only with Secure, for cookies other sites need).`);
    }
    return out;
  },
};

/** Google's threshold for a poor time to first byte. */
export const TTFB_POOR_MS = 1800;

export const slowResponse: Check = {
  id: "slow-response",
  version: "1.0.0",
  description: "The server takes over 1.8 s to start answering the page (time to first byte); a finding only when slow in every run",
  severity: "moderate",
  run(e) {
    const doc = pageDocument(e);
    if (doc?.ttfbMs === undefined || doc.ttfbMs <= TTFB_POOR_MS || normalizePageUrl(doc.request.url) === "") return [];
    const seconds = (doc.ttfbMs / 1000).toFixed(1);
    return [
      {
        fingerprint: fingerprintOf(this.id, "ttfb"),
        title: `The server takes ${seconds} s to start answering (poor: over 1.8 s)`,
        detail: `Time to first byte of ${doc.request.url}: ${Math.round(doc.ttfbMs)} ms (Google: good up to 800 ms, poor over 1800 ms). Measured from this computer, in the lab: it includes the network between here and the server.`,
        severity: "moderate",
        thirdParty: false,
        evidence: networkRef(e, doc, "The document's request and its timing"),
        assertion: null,
      },
    ];
  },
};

export const BACKEND_PAGE_CHECKS: readonly Check[] = [securityHeaders, cookies, slowResponse];
