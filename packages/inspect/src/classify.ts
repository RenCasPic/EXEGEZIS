import type { BlockInfo, BlockKind, NetworkFile, PageInspectionFile, PageStatus } from "@exegezis/core";

export interface VisitFacts {
  /** The navigation's error, when the page could not be loaded at all. */
  navigationError: string | null;
  network: NetworkFile | null;
  inspection: PageInspectionFile | null;
  requestedUrl: string;
  strictReadonly: boolean;
  /** A saved session was used for this visit (a login wall then means it expired). */
  sessionUsed?: boolean;
}

export interface Classification {
  status: PageStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  reason: string | null;
  block: BlockInfo | null;
}

const UNREACHABLE = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_ADDRESS|ERR_INTERNET_DISCONNECTED|ERR_CERT|ERR_SSL|ERR_BAD_SSL|ERR_TUNNEL|ERR_PROXY|ERR_EMPTY_RESPONSE|ERR_NETWORK|ERR_TIMED_OUT|NS_ERROR|SSL_ERROR|certificate/i;
const TIMEOUT = /Timeout \d+ms exceeded|timed out|TimeoutError/i;
/** Markers that only a challenge page has (iframes, challenge containers, #px-captcha…). */
const STRONG_MARKER = /iframe$|^\.|^#/;
const LOGIN_PATH = /(^|\/)(login|log-in|signin|sign-in|auth|account\/login|users\/sign_in|sso)(\/|$|\?)|[?&](next|returnurl|return_to|redirect_uri)=/i;
/** Cookies that anti-bot services set: evidence (names only), never a trigger on their own. */
const CHALLENGE_COOKIE = /^(cf_clearance|__cf_bm|datadome|_abck|bm_sz|ak_bmsc|_px\w*|_pxhd)$/;
const EVIDENCE_HEADERS = ["www-authenticate", "retry-after", "cf-mitigated", "server", "x-datadome", "cf-ray"];
const PRIVATE_HOST = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.(local|internal|intranet|corp|lan))$/i;

interface Document {
  status: number;
  url: string;
  headers: Record<string, string>;
}

/**
 * Deterministic classification of one visit (docs/09-access.md). A block is
 * recorded with its kind and evidence; nothing here (or anywhere) tries to
 * get past it. Detection order: HTTP_AUTH → BOT_CHALLENGE → SESSION_EXPIRED →
 * LOGIN_WALL → CONSENT_WALL → RATE_LIMITED → FORBIDDEN.
 */
export function classifyVisit(facts: VisitFacts): Classification {
  const document = mainDocument(facts.network);
  const httpStatus = document?.status ?? null;
  const finalUrl = document?.url ?? null;

  if (facts.navigationError !== null && httpStatus === null) {
    const message = facts.navigationError.split("\n")[0] ?? facts.navigationError;
    if (TIMEOUT.test(message) && !/ERR_TIMED_OUT/.test(message)) return { status: "TIMEOUT", httpStatus, finalUrl, reason: message, block: null };
    const restricted = networkRestriction(message, facts.requestedUrl);
    return {
      status: "UNREACHABLE",
      httpStatus,
      finalUrl,
      reason: UNREACHABLE.test(message) ? message : `navigation failed: ${message}`,
      block: restricted === null ? null : block("NETWORK_RESTRICTED", restricted, undefined, facts, {}),
    };
  }

  const kind = detectBlock(facts, document);
  if (kind !== null) {
    const headers = pick(document?.headers ?? {});
    return { status: "BLOCKED", httpStatus, finalUrl, reason: kind.detail, block: block(kind.kind, kind.detail, document, facts, headers, retryAfter(headers["retry-after"])) };
  }

  if (facts.navigationError !== null) {
    const message = facts.navigationError.split("\n")[0] ?? facts.navigationError;
    if (TIMEOUT.test(message)) return { status: "TIMEOUT", httpStatus, finalUrl, reason: message, block: null };
  }
  if (facts.strictReadonly && (facts.inspection?.blockedWrites.length ?? 0) > 0) {
    return { status: "DEGRADED", httpStatus, finalUrl, reason: `${facts.inspection?.blockedWrites.length ?? 0} write(s) of the page blocked by --strict-readonly`, block: null };
  }
  if (httpStatus !== null && httpStatus >= 400) return { status: "HTTP_ERROR", httpStatus, finalUrl, reason: `the page answered ${httpStatus}`, block: null };
  if (httpStatus === null) return { status: "UNREACHABLE", httpStatus, finalUrl, reason: "no response for the page", block: null };
  return { status: "OK", httpStatus, finalUrl, reason: null, block: null };
}

function detectBlock(facts: VisitFacts, document: Document | undefined): { kind: BlockKind; detail: string } | null {
  const status = document?.status ?? null;
  const headers = document?.headers ?? {};
  const signals = facts.inspection?.blockSignals;
  const markers = signals?.markers ?? [];
  const strong = markers.filter((m) => STRONG_MARKER.test(m));
  const challengeCookies = (signals?.cookieNames ?? []).filter((n) => CHALLENGE_COOKIE.test(n));

  // 1. HTTP_AUTH
  const auth = headers["www-authenticate"];
  if (status === 401 && auth !== undefined && /^\s*(basic|digest)\b/i.test(auth)) return { kind: "HTTP_AUTH", detail: `401 asking for ${auth.trim().split(/\s+/)[0]} authentication` };

  // 2. BOT_CHALLENGE
  if (strong.length > 0) return { kind: "BOT_CHALLENGE", detail: `anti-bot challenge: ${strong.join(", ")}` };
  if (/challenge/i.test(headers["cf-mitigated"] ?? "")) return { kind: "BOT_CHALLENGE", detail: "Cloudflare challenge (cf-mitigated: challenge)" };
  if (status !== null && [401, 403, 429, 503].includes(status) && (markers.length > 0 || headers["x-datadome"] !== undefined || (challengeCookies.length > 0 && /cloudflare|akamai/i.test(headers.server ?? "")))) {
    return { kind: "BOT_CHALLENGE", detail: `${status} with challenge signals: ${[...markers, ...challengeCookies.map((c) => `cookie ${c}`), ...(headers["x-datadome"] === undefined ? [] : ["x-datadome"])].join(", ")}` };
  }

  // 3–4. SESSION_EXPIRED / LOGIN_WALL
  const login = loginWall(facts, document);
  if (login !== null) return facts.sessionUsed === true ? { kind: "SESSION_EXPIRED", detail: `the saved session no longer works: ${login}` } : { kind: "LOGIN_WALL", detail: login };

  // 5. CONSENT_WALL
  const consent = signals?.consent ?? null;
  if (consent !== null && ((consent.vendor !== null && consent.coverage >= 0.3) || (consent.coverage >= 0.5 && consent.scrollLocked))) {
    return { kind: "CONSENT_WALL", detail: `cookie consent dialog${consent.vendor === null ? "" : ` (${consent.vendor})`} covers ${Math.round(consent.coverage * 100)}% of the page${consent.scrollLocked ? " and locks scrolling" : ""}` };
  }

  // 6. RATE_LIMITED
  if (status === 429 || (status === 503 && headers["retry-after"] !== undefined)) {
    return { kind: "RATE_LIMITED", detail: `${status}${headers["retry-after"] === undefined ? "" : ` · Retry-After: ${headers["retry-after"]}`}` };
  }

  // 7. FORBIDDEN
  if (status === 403) return { kind: "FORBIDDEN", detail: "403 Forbidden without a challenge (IP, country or WAF rule)" };
  if (status === 451) return { kind: "FORBIDDEN", detail: "451 Unavailable For Legal Reasons" };
  return null;
}

/**
 * A login wall only if (1) a non-login URL ended on a login route, or (2) the
 * page is mainly a login form (visible password field, little else, no main
 * content), or (3) a 401 without WWW-Authenticate. Inspecting a login URL
 * itself is never a wall; a login box next to visible content is not either.
 */
function loginWall(facts: VisitFacts, document: Document | undefined): string | null {
  if (isLoginUrl(facts.requestedUrl)) return null;
  if (document !== undefined && isLoginUrl(document.url) && samePlace(facts.requestedUrl, document.url) === false) return `redirected to the login page ${document.url}`;
  const login = facts.inspection?.blockSignals.login;
  if (login !== undefined && login.visiblePassword && login.wordsOutsideForms < 60 && !login.mainContent) return "the requested content is replaced by a login form";
  if (document?.status === 401 && document.headers["www-authenticate"] === undefined) return "401 from the application";
  return null;
}

export function isLoginUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return LOGIN_PATH.test(`${u.pathname}${u.search}`);
  } catch {
    return false;
  }
}

function samePlace(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return `${x.origin}${x.pathname}${x.search}` === `${y.origin}${y.pathname}${y.search}`;
  } catch {
    return false;
  }
}

function networkRestriction(message: string, requested: string): string | null {
  let host: string;
  try {
    host = new URL(requested).hostname;
  } catch {
    return null;
  }
  if (/ERR_PROXY|ERR_TUNNEL/i.test(message)) return `a proxy or tunnel refused the connection (${message.slice(0, 120)})`;
  if (/ERR_NAME_NOT_RESOLVED/i.test(message) && !/^[\d.:[\]]+$/.test(host)) return `the name ${host} does not resolve from this network (private DNS, VPN or a typo)`;
  if (PRIVATE_HOST.test(host) && /ERR_CONNECTION|ERR_ADDRESS|ERR_TIMED_OUT/i.test(message)) return `${host} is a private network address: it is only reachable from inside that network (VPN or intranet)`;
  return null;
}

function pick(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of EVIDENCE_HEADERS) {
    const v = headers[name];
    if (v === undefined) continue;
    // WWW-Authenticate: the scheme and realm are enough evidence.
    out[name] = name === "www-authenticate" ? v.slice(0, 120) : name === "x-datadome" ? "present" : v.slice(0, 200);
  }
  return out;
}

export function retryAfter(value: string | undefined, now = Date.now()): number | null {
  if (value === undefined) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.round((date - now) / 1000));
}

function block(kind: BlockKind, detail: string, document: Document | undefined, facts: VisitFacts, headers: Record<string, string>, retry: number | null = null): BlockInfo {
  return {
    kind,
    detail,
    evidence: {
      finalUrl: document?.url ?? null,
      httpStatus: document?.status ?? null,
      headers,
      cookieNames: (facts.inspection?.blockSignals.cookieNames ?? []).filter((n) => CHALLENGE_COOKIE.test(n)),
      markers: facts.inspection?.blockSignals.markers ?? [],
      screenshot: null,
    },
    retryAfterSeconds: retry,
  };
}

/** The last navigation response of the main document (after redirects). */
function mainDocument(network: NetworkFile | null): Document | undefined {
  if (network === null) return undefined;
  const navigations = network.exchanges.filter((x) => x.request.isNavigation && x.request.resourceType === "document" && x.response !== undefined);
  const final = navigations.filter((x) => (x.response?.status ?? 0) < 300 || (x.response?.status ?? 0) >= 400).at(-1) ?? navigations.at(-1);
  if (final?.response === undefined) return undefined;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(final.response.headers)) headers[k.toLowerCase()] = v;
  return { status: final.response.status, url: final.request.url, headers };
}
