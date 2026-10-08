import { isIP } from "node:net";
import { connect } from "node:tls";
import type { HttpProbe } from "@exegezis/adapter-browser";
import { fingerprintOf, type EvidenceRef, type InspectionObservation, type Severity } from "@exegezis/core";
import { actionReason } from "./link-safety.js";

/*
 * The site as a whole, seen from outside: its HTTPS (certificate, the way
 * from HTTP to HTTPS, redirect chains) and its configuration (robots.txt,
 * sitemap, what an unknown address answers). Probed once per run with GET
 * requests and a TLS handshake (read-only), saved as site-run-N.json, and
 * checked by pure functions of that record, like the page checks.
 */

export interface Hop {
  url: string;
  status: number;
}

export interface SiteFacts {
  schemaVersion: "exegezis.site-probe/v1";
  run: number;
  entry: string;
  /** The entry's redirects, one hop at a time. */
  entryChain: { hops: Hop[]; error: string | null };
  /** Loopback and private addresses (local fixtures, intranets) are not asked to use HTTPS. */
  local: boolean;
  tls: { checked: boolean; ok: boolean; error: string | null; validTo: string | null; daysLeft: number | null } | null;
  /** Where http://<host>/ leads. null when the site is local. */
  httpToHttps: { hops: Hop[]; error: string | null } | null;
  robots: { status: number | null; contentType: string | null; sitemaps: string[]; error: string | null };
  sitemap: {
    url: string;
    status: number | null;
    /** A <urlset> or <sitemapindex> document. */
    valid: boolean;
    locs: number;
    /** The first URLs it lists (same site), each asked once. */
    sampled: Hop[];
    error: string | null;
  } | null;
  /** What an address that cannot exist answers: a real 404 (or 410), or a page («soft 404»). */
  notFound: { url: string; status: number | null; error: string | null };
}

/** A path no site has: what it answers says whether missing pages get a real 404. */
export const NOT_FOUND_PATH = "/exegezis-check-missing-page-7f3a9c";
const SAMPLED_SITEMAP_URLS = 10;

function isLocal(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".test")) return true;
  if (isIP(h) === 4) return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(h);
  if (isIP(h) === 6) return h === "::1" || /^f[cd]/i.test(h) || /^fe80/i.test(h);
  return false;
}

/** The certificate the server presents, checked as a browser would (unless `ca` is given: tests). */
export function tlsFacts(hostname: string, port: number, options: { ca?: string; timeoutMs?: number } = {}): Promise<NonNullable<SiteFacts["tls"]>> {
  return new Promise((resolve) => {
    const socket = connect({
      host: hostname,
      port,
      ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
      ...(options.ca === undefined ? {} : { ca: options.ca }),
      rejectUnauthorized: true,
      timeout: options.timeoutMs ?? 15_000,
    });
    const done = (facts: NonNullable<SiteFacts["tls"]>) => {
      socket.destroy();
      resolve(facts);
    };
    socket.once("secureConnect", () => {
      const cert = socket.getPeerCertificate();
      const validTo = cert.valid_to === undefined ? null : new Date(cert.valid_to);
      done({
        checked: true,
        ok: true,
        error: null,
        validTo: validTo === null || Number.isNaN(validTo.getTime()) ? null : validTo.toISOString(),
        daysLeft: validTo === null || Number.isNaN(validTo.getTime()) ? null : Math.floor((validTo.getTime() - Date.now()) / 86_400_000),
      });
    });
    socket.once("timeout", () => done({ checked: true, ok: false, error: "TLS handshake timed out", validTo: null, daysLeft: null }));
    socket.once("error", (error: NodeJS.ErrnoException) => done({ checked: true, ok: false, error: error.code ?? error.message, validTo: null, daysLeft: null }));
  });
}

/** Probes the site for one run (GET requests and a TLS handshake only). */
export async function probeSite(probe: HttpProbe, entry: string, run: number, options: { tlsCa?: string; skipTls?: boolean; robotsAllowed?: (url: string) => boolean } = {}): Promise<SiteFacts> {
  const u = new URL(entry);
  const origin = u.origin;
  const local = isLocal(u.hostname);
  const entryChain = await probe.trace(entry);
  const finalUrl = entryChain.hops.at(-1)?.url ?? entry;
  const httpsHost = new URL(finalUrl).protocol === "https:" ? new URL(finalUrl) : u.protocol === "https:" ? u : null;
  let tls: SiteFacts["tls"] = null;
  if (httpsHost !== null && options.skipTls !== true) {
    tls = await tlsFacts(httpsHost.hostname.replace(/^\[|\]$/g, ""), Number(httpsHost.port || 443), options.tlsCa === undefined ? {} : { ca: options.tlsCa });
  } else if (httpsHost === null && !local) {
    // An HTTP site: does it have HTTPS at all?
    tls = await tlsFacts(u.hostname, 443, { timeoutMs: 8000 });
  }
  const httpToHttps = local || u.protocol === "http:" ? null : await probe.trace(`http://${u.host}/`);

  const robotsResult = await probe.get(`${origin}/robots.txt`, { text: true });
  const robotsText = robotsResult.ok && robotsResult.status === 200 && !/text\/html/i.test(robotsResult.contentType ?? "") ? (robotsResult.text ?? "") : "";
  const robots: SiteFacts["robots"] = robotsResult.ok
    ? { status: robotsResult.status, contentType: robotsResult.contentType, sitemaps: [...robotsText.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1] as string).slice(0, 5), error: null }
    : { status: null, contentType: null, sitemaps: [], error: robotsResult.error };

  const sitemapUrl = robots.sitemaps[0] ?? `${origin}/sitemap.xml`;
  let sitemap: SiteFacts["sitemap"];
  const sm = await probe.get(sitemapUrl, { text: true });
  if (!sm.ok) sitemap = { url: sitemapUrl, status: null, valid: false, locs: 0, sampled: [], error: sm.error };
  else {
    let text = sm.text ?? "";
    const valid = sm.status === 200 && /<(urlset|sitemapindex)[\s>]/i.test(text);
    let locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1] as string);
    // A sitemap index: the first sitemap it lists is sampled instead.
    if (valid && /<sitemapindex[\s>]/i.test(text) && locs[0] !== undefined) {
      const child = await probe.get(locs[0], { text: true });
      text = child.ok && child.status === 200 ? (child.text ?? "") : "";
      locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1] as string);
    }
    const own = locs.filter((l) => {
      try {
        return new URL(l).hostname.replace(/^www\./, "") === u.hostname.replace(/^www\./, "") && (options.robotsAllowed?.(l) ?? true);
      } catch {
        return false;
      }
    });
    const sampled: Hop[] = [];
    // Only pages, never an action or a technical route; HEAD first (link-safety.ts).
    for (const l of own.filter((x) => actionReason(x) === null).slice(0, SAMPLED_SITEMAP_URLS)) {
      const r = await probe.check(l, actionReason);
      if (r.ok) sampled.push({ url: l, status: r.status });
    }
    sitemap = { url: sitemapUrl, status: sm.status, valid, locs: locs.length, sampled, error: null };
  }

  const missing = await probe.get(`${origin}${NOT_FOUND_PATH}`);
  const notFound = missing.ok ? { url: `${origin}${NOT_FOUND_PATH}`, status: missing.status, error: null } : { url: `${origin}${NOT_FOUND_PATH}`, status: null, error: missing.error };
  return { schemaVersion: "exegezis.site-probe/v1", run, entry, entryChain, local, tls, httpToHttps, robots, sitemap, notFound };
}

/** What a site check looks at: one run's probe, and where it is saved. */
export interface SiteEvidence {
  facts: SiteFacts;
  /** The file, relative to the inspection directory. */
  path: string;
}

export interface SiteCheck {
  id: string;
  version: string;
  description: string;
  severity: Severity;
  run(evidence: SiteEvidence): InspectionObservation[];
}

const ref = (e: SiteEvidence, what: string, description: string): EvidenceRef[] => [{ kind: "network", path: e.path, ref: what, description }];

function obs(checkId: string, key: string, severity: Severity, title: string, detail: string, evidence: EvidenceRef[]): InspectionObservation {
  return { fingerprint: fingerprintOf(checkId, key), title, detail, severity, thirdParty: false, evidence, assertion: null };
}

/** Days before a certificate's end when it is reported. */
export const CERT_WARNING_DAYS = 30;
/** More hops than this from the address given to the page is a long chain. */
export const MAX_REDIRECTS = 2;

export const httpsCheck: SiteCheck = {
  id: "https",
  version: "1.0.0",
  description: "HTTPS: a valid certificate not about to expire (30 days), HTTP that redirects to HTTPS, redirect chains of at most 2 hops",
  severity: "serious",
  run(e) {
    const f = e.facts;
    const out: InspectionObservation[] = [];
    const entryHttps = new URL(f.entry).protocol === "https:" || (f.entryChain.hops.at(-1)?.url ?? "").startsWith("https:");
    if (!f.local && !entryHttps) {
      out.push(
        f.tls?.ok === true
          ? obs(this.id, "http-entry-no-redirect", "serious", "The site answers over HTTP without moving to HTTPS", `${f.entry} stays on plain HTTP although the server has a valid HTTPS certificate: visitors who type the address travel unencrypted. Suggested: redirect every HTTP address to its HTTPS one (301) and add HSTS.`, ref(e, "entryChain", "The entry's redirects"))
          : obs(this.id, "no-https", "serious", "The site does not use HTTPS", `${f.entry} is served over plain HTTP and port 443 does not offer a valid certificate (${f.tls?.error ?? "no answer"}): everything travels unencrypted, and browsers mark the site «Not secure».`, ref(e, "tls", "The TLS handshake")),
      );
    }
    if (entryHttps && f.tls?.checked === true) {
      if (!f.tls.ok) {
        out.push(obs(this.id, "cert-invalid", "critical", `The HTTPS certificate is not valid (${f.tls.error ?? "rejected"})`, `Browsers stop visitors with a security warning: the certificate was rejected (${f.tls.error ?? "rejected"}). Renew it or fix its chain or names.`, ref(e, "tls", "The TLS handshake")));
      } else if (f.tls.daysLeft !== null && f.tls.daysLeft < CERT_WARNING_DAYS) {
        out.push(obs(this.id, "cert-expiring", f.tls.daysLeft < 7 ? "serious" : "moderate", `The HTTPS certificate expires in ${f.tls.daysLeft} days`, `It is valid until ${f.tls.validTo ?? "?"}: renew it before then, or automate the renewal (e.g. Let's Encrypt).`, ref(e, "tls", "The TLS handshake")));
      }
    }
    if (f.httpToHttps !== null && f.httpToHttps.error === null) {
      const end = f.httpToHttps.hops.at(-1);
      if (end !== undefined && !end.url.startsWith("https:") && end.status < 400) {
        out.push(obs(this.id, "http-no-redirect", "moderate", "HTTP does not redirect to HTTPS", `http://${new URL(f.entry).host}/ answers ${end.status} at ${end.url} without moving to HTTPS: whoever types the address without https:// stays unencrypted. Suggested: a 301 to the HTTPS address, and HSTS.`, ref(e, "httpToHttps", "Where HTTP leads")));
      }
    }
    const redirects = f.entryChain.hops.filter((h) => h.status >= 300 && h.status < 400).length;
    if (redirects > MAX_REDIRECTS) {
      out.push(obs(this.id, "long-redirects", "minor", `${redirects} redirects before the page`, `${f.entryChain.hops.map((h) => `${h.url} (${h.status})`).join(" → ")}: each hop costs a round trip. Link straight to the final address.`, ref(e, "entryChain", "The entry's redirects")));
    }
    return out;
  },
};

export const siteConfig: SiteCheck = {
  id: "site-config",
  version: "1.0.0",
  description: "Configuration: robots.txt, a valid sitemap whose URLs answer, and a real 404 for pages that do not exist",
  severity: "moderate",
  run(e) {
    const f = e.facts;
    const out: InspectionObservation[] = [];
    const r = f.robots;
    if (r.status !== null && r.status >= 500) {
      out.push(obs(this.id, "robots-error", "serious", `robots.txt answers ${r.status}`, `A server error on /robots.txt makes Google stop crawling the site until it answers again. It should answer 200 (or 404 when there is none).`, ref(e, "robots", "/robots.txt")));
    } else if (r.status === 404 || r.status === 410) {
      out.push(obs(this.id, "robots-missing", "minor", "There is no robots.txt", "Optional, but it is where search engines look for the sitemap (Sitemap: line). Suggested: a robots.txt with «User-agent: *», «Allow: /» and the sitemap's address.", ref(e, "robots", "/robots.txt")));
    } else if (r.status === 200 && /text\/html/i.test(r.contentType ?? "")) {
      out.push(obs(this.id, "robots-html", "minor", "robots.txt is an HTML page", `/robots.txt answers 200 with ${r.contentType ?? "HTML"}: probably the site's page for missing addresses, so search engines find no rules.`, ref(e, "robots", "/robots.txt")));
    }
    const s = f.sitemap;
    if (s !== null) {
      const named = f.robots.sitemaps.includes(s.url);
      // /sitemap.xml was only a guess: a 404, or a page that is not a sitemap (a soft 404), means there is none.
      if (s.status === 404 || s.status === 410 || (!named && s.status === 200 && !s.valid)) {
        out.push(obs(this.id, "sitemap-missing", "minor", "There is no sitemap", `${s.url} answers ${s.status ?? "nothing"} and robots.txt names no other: search engines find pages only through links. Suggested: a sitemap.xml with the site's pages, named in robots.txt.`, ref(e, "sitemap", "The sitemap")));
      } else if (s.status !== null && s.status >= 400) {
        out.push(obs(this.id, "sitemap-error", "moderate", `The sitemap answers ${s.status}`, `${s.url}${named ? " (named in robots.txt)" : ""} answers ${s.status}.`, ref(e, "sitemap", "The sitemap")));
      } else if (s.status === 200 && !s.valid) {
        out.push(obs(this.id, "sitemap-invalid", "moderate", "The sitemap is not a valid sitemap", `${s.url} answers 200 but is not a sitemap (no <urlset> nor <sitemapindex>): search engines ignore it.`, ref(e, "sitemap", "The sitemap")));
      } else if (s.valid) {
        for (const h of s.sampled) {
          if (h.status >= 400) out.push(obs(this.id, `sitemap-url ${h.url.replace(/[?#].*$/, "")}`, "moderate", `The sitemap lists ${new URL(h.url).pathname}, which answers ${h.status}`, `${h.url} is in ${s.url} but answers ${h.status}: a sitemap should list only pages that exist.`, ref(e, "sitemap", "The sitemap and its sampled URLs")));
        }
      }
    }
    const n = f.notFound;
    if (n.status !== null && n.status >= 200 && n.status < 300) {
      out.push(obs(this.id, "soft-404", "moderate", "Missing pages answer 200 («soft 404»)", `${n.url}, an address that cannot exist, answers ${n.status} instead of 404: search engines may index error pages, and broken links cannot be detected. Answer missing addresses with 404 (or 410).`, ref(e, "notFound", "A missing address")));
    }
    return out;
  },
};

export const SITE_CHECKS: readonly SiteCheck[] = [httpsCheck, siteConfig];
