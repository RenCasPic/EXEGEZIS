import { parseSetCookies } from "@exegezis/adapter-browser";
import { describe, expect, it } from "vitest";
import { cookies, heavyResources, perfVitals, securityHeaders, slowResponse } from "../src/index.js";
import { httpsCheck, NOT_FOUND_PATH, siteConfig, type SiteFacts } from "../src/site.js";
import { evidence } from "./evidence.js";

const PAGE = "https://site.test/";
const SAFE_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=()",
};
const doc = (headers: Record<string, string>, extra: { ttfbMs?: number; status?: number; url?: string } = {}) => ({
  url: extra.url ?? PAGE,
  status: extra.status ?? 200,
  isNavigation: true,
  resourceType: "document",
  responseHeaders: headers,
  ...(extra.ttfbMs === undefined ? {} : { ttfbMs: extra.ttfbMs }),
});
const ids = (out: { fingerprint: string }[]) => out.map((o) => o.fingerprint.slice(o.fingerprint.indexOf(":") + 1)).sort();

describe("security-headers", () => {
  it("a page with every header gives nothing", () => {
    expect(securityHeaders.run(evidence({ exchanges: [doc(SAFE_HEADERS)] }))).toEqual([]);
  });

  it("names each missing header, with a suggestion", () => {
    const out = securityHeaders.run(evidence({ exchanges: [doc({})] }));
    expect(ids(out)).toEqual(["csp-missing", "framing-allowed", "hsts-missing", "nosniff-missing", "permissions-missing", "referrer-missing"]);
    expect(out.find((o) => o.fingerprint.endsWith("hsts-missing"))?.detail).toContain("max-age=31536000");
    expect(out.every((o) => !o.thirdParty)).toBe(true);
  });

  it("weak values: a short HSTS, an unsafe referrer policy; X-Frame-Options or frame-ancestors both protect", () => {
    const out = securityHeaders.run(evidence({ exchanges: [doc({ ...SAFE_HEADERS, "strict-transport-security": "max-age=600", "referrer-policy": "unsafe-url" })] }));
    expect(ids(out)).toEqual(["hsts-short", "referrer-unsafe"]);
    const xfo = { ...SAFE_HEADERS, "content-security-policy": "default-src 'self'", "x-frame-options": "SAMEORIGIN" };
    expect(securityHeaders.run(evidence({ exchanges: [doc(xfo)] }))).toEqual([]);
  });

  it("a CSP or referrer policy in <meta> counts; HSTS is not asked of plain HTTP", () => {
    const rest = { "x-content-type-options": "nosniff", "permissions-policy": "camera=()" };
    const out = securityHeaders.run(
      evidence({ page: "http://site.test/", exchanges: [doc({ ...rest, "x-frame-options": "DENY" }, { url: "http://site.test/" })], inspection: { meta: { title: "", lang: "en", viewport: null, h1Count: 1, protocol: "http:", cspMeta: "default-src 'self'", referrerMeta: "no-referrer" } } }),
    );
    expect(out).toEqual([]);
  });

  it("only the page's own document: another site's document or an error page are not judged", () => {
    expect(securityHeaders.run(evidence({ exchanges: [doc({}, { url: "https://other.example/" })] }))).toEqual([]);
    expect(securityHeaders.run(evidence({ exchanges: [doc({}, { status: 500 })] }))).toEqual([]);
  });
});

describe("cookies", () => {
  it("reads the attributes of Set-Cookie, never the value", () => {
    const parsed = parseSetCookies("sessionid=SECRET123; Path=/; HttpOnly\ntheme=dark; Secure; SameSite=Lax; Max-Age=3600", PAGE);
    expect(parsed).toEqual([
      { name: "sessionid", url: PAGE, secure: false, httpOnly: true, sameSite: null, session: true },
      { name: "theme", url: PAGE, secure: true, httpOnly: false, sameSite: "Lax", session: false },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("SECRET123");
  });

  it("an insecure session cookie on HTTPS: no Secure, no HttpOnly, no SameSite", () => {
    const out = cookies.run(evidence({ inspection: { setCookies: parseSetCookies("PHPSESSID=x; Path=/", PAGE) } }));
    expect(ids(out)).toEqual(["no-samesite PHPSESSID", "not-httponly PHPSESSID", "not-secure PHPSESSID"]);
  });

  it("a well-set cookie, and a preference cookie readable by scripts, give nothing", () => {
    const out = cookies.run(evidence({ inspection: { setCookies: parseSetCookies("sid=x; Secure; HttpOnly; SameSite=Lax\ntheme=dark; Secure; SameSite=Lax", PAGE) } }));
    expect(out).toEqual([]);
  });
});

describe("slow-response", () => {
  it("over 1.8 s to the first byte; not under", () => {
    expect(slowResponse.run(evidence({ exchanges: [doc(SAFE_HEADERS, { ttfbMs: 2400 })] }))[0]?.title).toBe("The server takes 2.4 s to start answering (poor: over 1.8 s)");
    expect(slowResponse.run(evidence({ exchanges: [doc(SAFE_HEADERS, { ttfbMs: 900 })] }))).toEqual([]);
  });
});

describe("perf-vitals", () => {
  const perf = (p: Partial<{ lcpMs: number; cls: number; tbtMs: number }>) => ({ fcpMs: 500, lcpMs: null, cls: null, tbtMs: null, domContentLoadedMs: 400, loadMs: 900, images: [], devicePixelRatio: 1, ...p });
  it("poor LCP, CLS and TBT by Google's thresholds; good or improvable values give nothing", () => {
    expect(ids(perfVitals.run(evidence({ inspection: { performance: perf({ lcpMs: 5200, cls: 0.4, tbtMs: 900 }) } })))).toEqual(["cls", "lcp", "tbt"]);
    expect(perfVitals.run(evidence({ inspection: { performance: perf({ lcpMs: 3900, cls: 0.2, tbtMs: 500 }) } }))).toEqual([]);
    expect(perfVitals.run(evidence({}))).toEqual([]);
  });
  it("says it is a lab measurement", () => {
    expect(perfVitals.run(evidence({ inspection: { performance: perf({ lcpMs: 5200 }) } }))[0]?.detail).toMatch(/Lab measurement.*not data from real visitors/);
  });
});

describe("heavy-resources", () => {
  const img = (url: string, bytes: number, type = "image/jpeg", headers: Record<string, string> = { "cache-control": "max-age=86400" }) => ({ url, status: 200, resourceType: "image", bytes, responseHeaders: { "content-type": type, ...headers } });
  it("an image over 300 KB in JPEG: heavy and an old format", () => {
    expect(ids(heavyResources.run(evidence({ exchanges: [img("https://site.test/hero.jpg", 420 * 1024)] })))).toEqual(["heavy-image https://site.test/hero.jpg", "legacy-format https://site.test/hero.jpg"]);
  });
  it("a small WebP and an SVG give nothing", () => {
    expect(heavyResources.run(evidence({ exchanges: [img("https://site.test/a.webp", 40 * 1024, "image/webp"), img("https://site.test/logo.svg", 900 * 1024, "image/svg+xml")] }))).toEqual([]);
  });
  it("an image with far more pixels than it is drawn with", () => {
    const performance = { fcpMs: 1, lcpMs: 1, cls: 0, tbtMs: 0, domContentLoadedMs: 1, loadMs: 1, devicePixelRatio: 1, images: [{ url: "https://site.test/p.webp", naturalWidth: 2000, naturalHeight: 1500, width: 200, height: 150 }] };
    expect(ids(heavyResources.run(evidence({ exchanges: [img("https://site.test/p.webp", 80 * 1024, "image/webp")], inspection: { performance } })))).toEqual(["oversized-image https://site.test/p.webp"]);
  });
  it("uncompressed JS and CSS; files without any caching; another site's file is third party", () => {
    const out = heavyResources.run(
      evidence({
        exchanges: [
          { url: "https://site.test/app.js", status: 200, resourceType: "script", bytes: 60 * 1024, responseHeaders: { "content-type": "application/javascript", "cache-control": "max-age=600" } },
          { url: "https://site.test/app.css", status: 200, resourceType: "stylesheet", bytes: 20 * 1024, responseHeaders: { "content-type": "text/css", "content-encoding": "br", "cache-control": "no-store" } },
          { url: "https://cdn.ads.example/ad.js", status: 200, resourceType: "script", bytes: 30 * 1024, responseHeaders: { "content-type": "text/javascript", etag: "x" } },
        ],
      }),
    );
    expect(ids(out)).toEqual(["no-cache https://site.test/app.css", "uncompressed https://cdn.ads.example/ad.js", "uncompressed https://site.test/app.js"]);
    expect(out.find((o) => o.fingerprint.includes("ads.example"))?.thirdParty).toBe(true);
  });
  it("an ETag or Last-Modified is enough caching", () => {
    expect(heavyResources.run(evidence({ exchanges: [{ url: "https://site.test/f.woff2", status: 200, resourceType: "font", bytes: 5000, responseHeaders: { "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT" } }] }))).toEqual([]);
  });
});

describe("site checks", () => {
  const facts = (patch: Partial<SiteFacts> = {}): SiteFacts => ({
    schemaVersion: "exegezis.site-probe/v1",
    run: 1,
    entry: "https://site.test/",
    entryChain: { hops: [{ url: "https://site.test/", status: 200 }], error: null },
    local: false,
    tls: { checked: true, ok: true, error: null, validTo: "2027-06-01T00:00:00.000Z", daysLeft: 200 },
    httpToHttps: { hops: [{ url: "http://site.test/", status: 301 }, { url: "https://site.test/", status: 200 }], error: null },
    robots: { status: 200, contentType: "text/plain", sitemaps: ["https://site.test/sitemap.xml"], error: null },
    sitemap: { url: "https://site.test/sitemap.xml", status: 200, valid: true, locs: 2, sampled: [{ url: "https://site.test/", status: 200 }, { url: "https://site.test/a", status: 200 }], error: null },
    notFound: { url: `https://site.test${NOT_FOUND_PATH}`, status: 404, error: null },
    ...patch,
  });
  const run = (f: SiteFacts) => [...httpsCheck.run({ facts: f, path: "site-run-1.json" }), ...siteConfig.run({ facts: f, path: "site-run-1.json" })];

  it("a healthy site gives nothing", () => {
    expect(run(facts())).toEqual([]);
  });

  it("HTTPS: an invalid or expiring certificate, HTTP that stays HTTP, a long redirect chain", () => {
    expect(ids(run(facts({ tls: { checked: true, ok: false, error: "CERT_HAS_EXPIRED", validTo: null, daysLeft: null } })))).toEqual(["cert-invalid"]);
    const expiring = run(facts({ tls: { checked: true, ok: true, error: null, validTo: "2026-10-20T00:00:00.000Z", daysLeft: 12 } }));
    expect(expiring.map((o) => [o.title, o.severity])).toEqual([["The HTTPS certificate expires in 12 days", "moderate"]]);
    expect(ids(run(facts({ httpToHttps: { hops: [{ url: "http://site.test/", status: 200 }], error: null } })))).toEqual(["http-no-redirect"]);
    const hops = [301, 302, 301].map((status, i) => ({ url: `https://site.test/${i}`, status }));
    expect(ids(run(facts({ entryChain: { hops: [...hops, { url: "https://site.test/end", status: 200 }], error: null } })))).toEqual(["long-redirects"]);
  });

  it("a plain HTTP site: no HTTPS at all; a local one is not asked", () => {
    const http = { entry: "http://site.test/", entryChain: { hops: [{ url: "http://site.test/", status: 200 }], error: null }, httpToHttps: null };
    expect(ids(run(facts({ ...http, tls: { checked: true, ok: false, error: "ECONNREFUSED", validTo: null, daysLeft: null } })))).toEqual(["no-https"]);
    expect(run(facts({ ...http, local: true, tls: null }))).toEqual([]);
  });

  it("configuration: a soft 404, a broken sitemap and its dead URLs, robots.txt missing or failing", () => {
    expect(ids(run(facts({ notFound: { url: "https://site.test/x", status: 200, error: null } })))).toEqual(["soft-404"]);
    const broken = facts({ sitemap: { url: "https://site.test/sitemap.xml", status: 200, valid: false, locs: 0, sampled: [], error: null } });
    expect(ids(run(broken))).toEqual(["sitemap-invalid"]);
    const dead = facts({ sitemap: { url: "https://site.test/sitemap.xml", status: 200, valid: true, locs: 2, sampled: [{ url: "https://site.test/gone", status: 404 }], error: null } });
    expect(ids(run(dead))).toEqual(["sitemap-url https://site.test/gone"]);
    expect(ids(run(facts({ robots: { status: 404, contentType: "text/html", sitemaps: [], error: null }, sitemap: { url: "https://site.test/sitemap.xml", status: 404, valid: false, locs: 0, sampled: [], error: null } })))).toEqual([
      "robots-missing",
      "sitemap-missing",
    ]);
    expect(ids(run(facts({ robots: { status: 503, contentType: "text/html", sitemaps: [], error: null } })))).toEqual(["robots-error"]);
  });

  it("a guessed /sitemap.xml that is the site's HTML page means there is no sitemap", () => {
    const f = facts({ robots: { status: 200, contentType: "text/plain", sitemaps: [], error: null }, sitemap: { url: "https://site.test/sitemap.xml", status: 200, valid: false, locs: 0, sampled: [], error: null } });
    expect(ids(run(f))).toEqual(["sitemap-missing"]);
  });
});
