import { a11y } from "./a11y.js";
import { brokenLinks } from "./broken-links.js";
import { consoleErrors } from "./console-errors.js";
import { failedRequests } from "./failed-requests.js";
import { jsExceptions } from "./js-exceptions.js";
import { mixedContent } from "./mixed-content.js";
import { seoBasics } from "./seo-basics.js";
import type { Check } from "./types.js";

/** Every check, in report order. Adding a check = adding a module here. */
export const CHECKS: readonly Check[] = [jsExceptions, consoleErrors, failedRequests, brokenLinks, a11y, mixedContent, seoBasics];

export function selectChecks(ids: readonly string[] | undefined): Check[] {
  if (ids === undefined || ids.length === 0) return [...CHECKS];
  const unknown = ids.filter((id) => !CHECKS.some((c) => c.id === id));
  if (unknown.length > 0) throw new Error(`unknown check(s): ${unknown.join(", ")}; available: ${CHECKS.map((c) => c.id).join(", ")}`);
  return CHECKS.filter((c) => ids.includes(c.id));
}

export { a11y, brokenLinks, consoleErrors, failedRequests, jsExceptions, mixedContent, seoBasics };
export { stableFragment, type Check, type LinkStatus, type PageEvidence } from "./types.js";
