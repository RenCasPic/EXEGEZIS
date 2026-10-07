import type { InspectionStatus, PageStatus } from "@exegezis/core";
import type { Tone } from "./evidence/stages";

/*
 * Tones of inspection and page statuses. Their words are in the catalogs:
 * labels.status.<CODE> (the pill) and inspections.statusText.<CODE>.
 */

export const INSPECTION_STATUS_TONE: Record<InspectionStatus, Tone> = {
  COMPLETED: "ok",
  PARTIAL: "warn",
  BLOCKED: "warn",
  UNREACHABLE: "q",
  TIMEOUT: "q",
  ENGINE_ERROR: "bad",
};

export const PAGE_STATUS_TONE: Record<PageStatus, Tone> = {
  OK: "ok",
  HTTP_ERROR: "off",
  DEGRADED: "warn",
  BLOCKED: "warn",
  UNREACHABLE: "q",
  TIMEOUT: "q",
  SKIPPED_BUDGET: "q",
  SKIPPED_ROBOTS: "q",
};

/** The checks EXEGEZIS has (their names: inspections.check.<id>). */
export const CHECK_IDS = [
  "js-exceptions",
  "console-errors",
  "failed-requests",
  "broken-links",
  "a11y",
  "mixed-content",
  "seo-basics",
  "mobile-scroll",
  "mobile-tap-targets",
  "mobile-text-size",
  "mobile-viewport",
  "mobile-fixed-overlap",
  "perf-vitals",
  "heavy-resources",
  "security-headers",
  "cookies",
  "slow-response",
  "https",
  "site-config",
] as const;

export const isKnownCheck = (id: string): id is (typeof CHECK_IDS)[number] => (CHECK_IDS as readonly string[]).includes(id);

/** Path + query of a URL on the inspected origin; the full URL otherwise. */
export function shortUrl(url: string, origin: string): string {
  try {
    const u = new URL(url);
    return u.origin === origin ? `${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
}
