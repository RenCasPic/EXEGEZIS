import type { NetworkFile, PageInspectionFile, PageStatus } from "@exegezis/core";

export interface VisitFacts {
  /** The navigation's error, when the page could not be loaded at all. */
  navigationError: string | null;
  network: NetworkFile | null;
  inspection: PageInspectionFile | null;
  requestedUrl: string;
  strictReadonly: boolean;
}

export interface Classification {
  status: PageStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  reason: string | null;
}

const UNREACHABLE = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_ADDRESS|ERR_INTERNET_DISCONNECTED|ERR_CERT|ERR_SSL|ERR_BAD_SSL|ERR_TUNNEL|ERR_PROXY|ERR_EMPTY_RESPONSE|ERR_NETWORK|ERR_TIMED_OUT|NS_ERROR|SSL_ERROR|certificate/i;
const TIMEOUT = /Timeout \d+ms exceeded|timed out|TimeoutError/i;
const CHALLENGE_STATUS = new Set([401, 403, 429, 503]);
const STRONG_MARKER = /iframe$|^\.|^#/;
const LOGIN_PATH = /(^|\/)(login|log-in|signin|sign-in|auth|account\/login|sso)(\/|$|\?)/i;

/**
 * Deterministic classification of one visit. Blocking signals are recorded
 * and reported as BLOCKED; nothing here (or anywhere) tries to get past them.
 */
export function classifyVisit(facts: VisitFacts): Classification {
  const document = mainDocument(facts.network);
  const httpStatus = document?.status ?? null;
  const finalUrl = document?.url ?? null;

  if (facts.navigationError !== null && httpStatus === null) {
    const message = facts.navigationError.split("\n")[0] ?? facts.navigationError;
    if (TIMEOUT.test(message) && !/ERR_TIMED_OUT/.test(message)) return { status: "TIMEOUT", httpStatus, finalUrl, reason: message };
    return { status: "UNREACHABLE", httpStatus, finalUrl, reason: UNREACHABLE.test(message) ? message : `navigation failed: ${message}` };
  }

  if (httpStatus === 451) return { status: "BLOCKED", httpStatus, finalUrl, reason: "451 Unavailable For Legal Reasons" };
  const markers = facts.inspection?.blockSignals.markers ?? [];
  const strong = markers.filter((m) => STRONG_MARKER.test(m));
  if (strong.length > 0) return { status: "BLOCKED", httpStatus, finalUrl, reason: `CAPTCHA or anti-bot challenge: ${strong.join(", ")}` };
  if (httpStatus !== null && CHALLENGE_STATUS.has(httpStatus) && markers.length > 0) {
    return { status: "BLOCKED", httpStatus, finalUrl, reason: `${httpStatus} with challenge markers: ${markers.join(", ")}` };
  }
  if (facts.inspection?.blockSignals.passwordField === true && finalUrl !== null && redirectedToLogin(facts.requestedUrl, finalUrl)) {
    return { status: "BLOCKED", httpStatus, finalUrl, reason: `login wall: redirected to ${finalUrl}` };
  }
  if (facts.navigationError !== null) {
    const message = facts.navigationError.split("\n")[0] ?? facts.navigationError;
    if (TIMEOUT.test(message)) return { status: "TIMEOUT", httpStatus, finalUrl, reason: message };
  }
  if (facts.strictReadonly && (facts.inspection?.blockedWrites.length ?? 0) > 0) {
    return { status: "DEGRADED", httpStatus, finalUrl, reason: `${facts.inspection?.blockedWrites.length ?? 0} write(s) of the page blocked by --strict-readonly` };
  }
  if (httpStatus !== null && httpStatus >= 400) return { status: "HTTP_ERROR", httpStatus, finalUrl, reason: `the page answered ${httpStatus}` };
  if (httpStatus === null) return { status: "UNREACHABLE", httpStatus, finalUrl, reason: "no response for the page" };
  return { status: "OK", httpStatus, finalUrl, reason: null };
}

/** The last navigation response of the main document (after redirects). */
function mainDocument(network: NetworkFile | null): { status: number; url: string } | undefined {
  if (network === null) return undefined;
  const navigations = network.exchanges.filter((x) => x.request.isNavigation && x.request.resourceType === "document" && x.response !== undefined);
  const final = navigations.filter((x) => (x.response?.status ?? 0) < 300 || (x.response?.status ?? 0) >= 400).at(-1) ?? navigations.at(-1);
  if (final?.response === undefined) return undefined;
  return { status: final.response.status, url: final.request.url };
}

function redirectedToLogin(requested: string, final: string): boolean {
  try {
    const a = new URL(requested);
    const b = new URL(final);
    return `${a.pathname}${a.search}` !== `${b.pathname}${b.search}` && LOGIN_PATH.test(`${b.pathname}${b.search}`);
  } catch {
    return false;
  }
}
