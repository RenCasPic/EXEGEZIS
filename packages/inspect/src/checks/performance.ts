import { sameSite } from "@exegezis/adapter-browser";
import { fingerprintOf, VITALS, type InspectionObservation, type NetworkExchangeEvidence, type Severity } from "@exegezis/core";
import { pageEvidence, type Check, type PageEvidence } from "./types.js";

/*
 * Lab performance of each page on each device: measured in the browser on
 * this computer (not field data from real visitors). The metrics are kept
 * per visit (the report shows each one's median and range); these checks
 * turn into findings only what is poor by Google's thresholds, and
 * perf-vitals only when poor in every run (ALL_RUNS_ONLY in core).
 */

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};
const noQuery = (url: string) => url.replace(/[?#].*$/, "");
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;
const metricsRef = (e: PageEvidence) => pageEvidence(e, [{ kind: "dom", path: `${e.runPath}/inspection.json`, ref: "performance", description: "Lab performance of the visit" }]);

export const perfVitals: Check = {
  id: "perf-vitals",
  version: "1.0.0",
  description: "Core Web Vitals in the lab: LCP over 4 s, CLS over 0.25, Total Blocking Time over 600 ms (poor by Google's thresholds, in every run)",
  severity: "moderate",
  run(e) {
    const p = e.inspection.performance;
    if (p === null) return [];
    const out: InspectionObservation[] = [];
    const add = (metric: string, title: string, detail: string) =>
      out.push({ fingerprint: fingerprintOf(this.id, metric), title, detail: `${detail} Lab measurement from this computer (${e.device}), not data from real visitors.`, severity: "moderate", thirdParty: false, evidence: metricsRef(e), assertion: null });
    if (p.lcpMs !== null && p.lcpMs > VITALS.lcpMs.poor) {
      add("lcp", `Largest Contentful Paint ${(p.lcpMs / 1000).toFixed(1)} s (poor: over 4 s)`, `The main content takes ${Math.round(p.lcpMs)} ms to appear (Google: good up to 2.5 s, poor over 4 s).`);
    }
    if (p.cls !== null && p.cls > VITALS.cls.poor) {
      add("cls", `Cumulative Layout Shift ${p.cls.toFixed(2)} (poor: over 0.25)`, `The content moves while the page loads: CLS ${p.cls.toFixed(3)} (Google: good up to 0.1, poor over 0.25). Give images and embeds a size, and do not insert content above what is shown.`);
    }
    if (p.tbtMs !== null && p.tbtMs > VITALS.tbtMs.poor) {
      add("tbt", `Total Blocking Time ${Math.round(p.tbtMs)} ms (poor: over 600 ms)`, `Long JavaScript tasks block the page for ${Math.round(p.tbtMs)} ms after the first paint (Lighthouse: good up to 200 ms, poor over 600 ms); clicks and typing wait meanwhile (an approximation of INP in the lab).`);
    }
    return out;
  },
};

/** Thresholds for heavy resources. */
export const HEAVY_IMAGE_BYTES = 300 * 1024;
const MODERN_FORMAT_MIN_BYTES = 100 * 1024;
const OVERSIZED_MIN_BYTES = 50 * 1024;
const UNCOMPRESSED_MIN_BYTES = 10 * 1024;

const STATIC_TYPES = new Set(["script", "stylesheet", "image", "font"]);

/** No way for the browser to keep the file: no-store, or no Cache-Control, Expires, ETag nor Last-Modified at all. */
function uncacheable(h: Record<string, string>): boolean {
  const cc = (h["cache-control"] ?? "").toLowerCase();
  if (/no-store/.test(cc)) return true;
  if (/max-age\s*=\s*[1-9]|s-maxage\s*=\s*[1-9]|immutable/.test(cc)) return false;
  return h["expires"] === undefined && h["etag"] === undefined && h["last-modified"] === undefined && !/max-age|no-cache/.test(cc);
}

export const heavyResources: Check = {
  id: "heavy-resources",
  version: "1.0.0",
  description: "Heavy resources: images over 300 KB, images much larger than shown, JPEG/PNG instead of WebP/AVIF, uncompressed JS/CSS, files the browser cannot cache",
  severity: "moderate",
  run(e) {
    const out: InspectionObservation[] = [];
    const seen = new Set<string>();
    const shown = new Map((e.inspection.performance?.images ?? []).map((i) => [noQuery(i.url), i]));
    const dpr = e.inspection.performance?.devicePixelRatio ?? 1;
    for (const x of e.network.exchanges) {
      const r = x.response;
      if (r === undefined || r.status !== 200 || x.sizes === undefined || x.request.method !== "GET") continue;
      const url = noQuery(x.request.url);
      // An address with a redacted part is not a usable address (found on practicetestautomation.com).
      if (!/^https?:/.test(url) || !URL.canParse(url) || seen.has(url)) continue;
      seen.add(url);
      const h = Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const type = (h["content-type"] ?? "").toLowerCase();
      const bytes = x.sizes.body;
      // An image drawn in the page itself is the site's content, even from a CDN (i0.wp.com, cloudfront…).
      const thirdParty = !sameSite(host(x.request.url), host(e.page)) && !shown.has(url);
      const name = new URL(url).pathname.split("/").pop() || url;
      const add = (rule: string, severity: Severity, title: string, detail: string) => out.push(observation(e, x, `${rule} ${url}`, severity, title, detail, thirdParty));
      const image = x.request.resourceType === "image" || type.startsWith("image/");
      if (image && !type.includes("svg")) {
        if (bytes > HEAVY_IMAGE_BYTES) add("heavy-image", "moderate", `Image of ${kb(bytes)}: ${name}`, `${url} weighs ${kb(bytes)} (over 300 KB). Compress it, serve it in WebP or AVIF, and at the size it is shown.`);
        if (/image\/(jpeg|jpg|png|gif|bmp)/.test(type) && bytes >= MODERN_FORMAT_MIN_BYTES) add("legacy-format", "minor", `Image in ${type.replace("image/", "").toUpperCase()} instead of WebP/AVIF: ${name}`, `${url} (${kb(bytes)}, ${type}): WebP or AVIF usually weigh 25–50 % less for the same quality.`);
        const drawn = shown.get(url);
        if (drawn !== undefined && bytes >= OVERSIZED_MIN_BYTES && drawn.naturalWidth > 2 * drawn.width * dpr && drawn.naturalHeight > 2 * drawn.height * dpr) {
          add(
            "oversized-image",
            "minor",
            `Image of ${drawn.naturalWidth}×${drawn.naturalHeight} px shown at ${Math.round(drawn.width)}×${Math.round(drawn.height)} px: ${name}`,
            `${url} (${kb(bytes)}) has ${drawn.naturalWidth}×${drawn.naturalHeight} px but is drawn at ${Math.round(drawn.width)}×${Math.round(drawn.height)} CSS px (×${dpr} on this screen): more than twice the pixels it needs in each direction. Serve a smaller version (srcset).`,
          );
        }
      }
      const text = x.request.resourceType === "script" || x.request.resourceType === "stylesheet" || /javascript|ecmascript|text\/css/.test(type);
      if (text && bytes >= UNCOMPRESSED_MIN_BYTES && (h["content-encoding"] ?? "identity").toLowerCase() === "identity") {
        add("uncompressed", "minor", `${/css/.test(type) || x.request.resourceType === "stylesheet" ? "CSS" : "JavaScript"} sent without compression: ${name}`, `${url} travels uncompressed (${kb(bytes)}, no Content-Encoding). gzip or Brotli usually cut a text file by 70 % or more.`);
      }
      if (STATIC_TYPES.has(x.request.resourceType) && uncacheable(h)) {
        add("no-cache", "minor", `File the browser cannot keep: ${name}`, `${url} (${x.request.resourceType}) comes with ${h["cache-control"] === undefined ? "no Cache-Control, Expires, ETag or Last-Modified" : `Cache-Control: ${h["cache-control"]}`}: it is downloaded again on every visit. Suggested: Cache-Control: max-age=31536000, immutable for versioned files, or at least an ETag.`);
      }
    }
    return out;
  },
};

function observation(e: PageEvidence, x: NetworkExchangeEvidence, key: string, severity: Severity, title: string, detail: string, thirdParty: boolean): InspectionObservation {
  return {
    fingerprint: fingerprintOf("heavy-resources", key),
    title: title.slice(0, 200),
    detail,
    severity: thirdParty ? "minor" : severity,
    thirdParty,
    evidence: pageEvidence(e, [{ kind: "network", path: `${e.runPath}/network.json`, ref: x.id, description: "The resource's request, headers and size" }]),
    assertion: null,
  };
}

export const PERFORMANCE_CHECKS: readonly Check[] = [perfVitals, heavyResources];
