import { a11y } from "./a11y.js";
import { BACKEND_PAGE_CHECKS, cookies, securityHeaders, slowResponse } from "./backend.js";
import { brokenLinks } from "./broken-links.js";
import { consoleErrors } from "./console-errors.js";
import { failedRequests } from "./failed-requests.js";
import { jsExceptions } from "./js-exceptions.js";
import { mixedContent } from "./mixed-content.js";
import { MOBILE_CHECKS, mobileFixedOverlap, mobileScroll, mobileTapTargets, mobileTextSize, mobileViewport } from "./mobile.js";
import { heavyResources, PERFORMANCE_CHECKS, perfVitals } from "./performance.js";
import { seoBasics } from "./seo-basics.js";
import { SITE_CHECKS, type SiteCheck } from "../site.js";
import type { Check } from "./types.js";

/** Every check, in report order. Adding a check = adding a module here. */
export const CHECKS: readonly Check[] = [jsExceptions, consoleErrors, failedRequests, brokenLinks, a11y, mixedContent, seoBasics, ...MOBILE_CHECKS, ...PERFORMANCE_CHECKS, ...BACKEND_PAGE_CHECKS];

/** The page checks and the site checks (site.ts) asked for: all of them by default. */
export function selectChecks(ids: readonly string[] | undefined): Check[] {
  if (ids === undefined || ids.length === 0) return [...CHECKS];
  const unknown = ids.filter((id) => !CHECKS.some((c) => c.id === id) && !SITE_CHECKS.some((c) => c.id === id));
  if (unknown.length > 0) throw new Error(`unknown check(s): ${unknown.join(", ")}; available: ${[...CHECKS, ...SITE_CHECKS].map((c) => c.id).join(", ")}`);
  return CHECKS.filter((c) => ids.includes(c.id));
}

export function selectSiteChecks(ids: readonly string[] | undefined): SiteCheck[] {
  if (ids === undefined || ids.length === 0) return [...SITE_CHECKS];
  return SITE_CHECKS.filter((c) => ids.includes(c.id));
}

export { cookies, heavyResources, perfVitals, securityHeaders, slowResponse };
export { BACKEND_PAGE_CHECKS, PERFORMANCE_CHECKS };
export { a11y, brokenLinks, consoleErrors, failedRequests, jsExceptions, mixedContent, mobileFixedOverlap, mobileScroll, mobileTapTargets, mobileTextSize, mobileViewport, seoBasics };
export { stableFragment, type Check, type LinkStatus, type PageEvidence } from "./types.js";
