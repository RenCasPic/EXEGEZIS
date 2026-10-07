import { englishOf, msg, type BlockInfo, type BlockKind, type EngineMessage, type NetworkFile, type PageInspectionFile, type PageStatus } from "@exegezis/core";

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
  /** The reason as a code and parameters (docs/11-i18n.md). */
  reasonMessage?: EngineMessage;
  block: BlockInfo | null;
}

/** A classification whose reason is a message (the English text is derived from it). */
function classified(status: PageStatus, httpStatus: number | null, finalUrl: string | null, reason: EngineMessage | null, block: BlockInfo | null = null): Classification {
  return reason === null ? { status, httpStatus, finalUrl, reason: null, block } : { status, httpStatus, finalUrl, reason: englishOf(reason), reasonMessage: reason, block };
}

const UNREACHABLE = /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_ADDRESS|ERR_INTERNET_DISCONNECTED|ERR_CERT|ERR_SSL|ERR_BAD_SSL|ERR_TUNNEL|ERR_PROXY|ERR_EMPTY_RESPONSE|ERR_NETWORK|ERR_TIMED_OUT|NS_ERROR|SSL_ERROR|certificate/i;
const TIMEOUT = /Timeout \d+ms exceeded|timed out|TimeoutError/i;
/** Markers that only a challenge page has (iframes, challenge containers, #px-captcha…). */
const STRONG_MARKER = /iframe$|^\.|^#/;
/** Words of its own (outside forms, menus, header and footer) that make a page more than a challenge. */
const CONTENT_WORDS = 150;
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
    if (TIMEOUT.test(message) && !/ERR_TIMED_OUT/.test(message)) return classified("TIMEOUT", httpStatus, finalUrl, msg("pageBrowserError", { message }));
    const restricted = networkRestriction(message, facts.requestedUrl);
    return classified(
      "UNREACHABLE",
      httpStatus,
      finalUrl,
      UNREACHABLE.test(message) ? msg("pageBrowserError", { message }) : msg("pageNavigationFailed", { message }),
      restricted === null ? null : block("NETWORK_RESTRICTED", restricted, undefined, facts, {}),
    );
  }

  const kind = detectBlock(facts, document);
  if (kind !== null) {
    const headers = pick(document?.headers ?? {});
    return classified("BLOCKED", httpStatus, finalUrl, kind.message, block(kind.kind, kind.message, document, facts, headers, retryAfter(headers["retry-after"])));
  }

  if (facts.navigationError !== null) {
    const message = facts.navigationError.split("\n")[0] ?? facts.navigationError;
    if (TIMEOUT.test(message)) return classified("TIMEOUT", httpStatus, finalUrl, msg("pageBrowserError", { message }));
  }
  if (facts.strictReadonly && (facts.inspection?.blockedWrites.length ?? 0) > 0) {
    return classified("DEGRADED", httpStatus, finalUrl, msg("pageWritesBlocked", { count: facts.inspection?.blockedWrites.length ?? 0 }));
  }
  if (httpStatus !== null && httpStatus >= 400) return classified("HTTP_ERROR", httpStatus, finalUrl, msg("pageHttpError", { status: String(httpStatus) }));
  if (httpStatus === null) return classified("UNREACHABLE", httpStatus, finalUrl, msg("pageNoResponse"));
  return { status: "OK", httpStatus, finalUrl, reason: null, block: null };
}

function detectBlock(facts: VisitFacts, document: Document | undefined): { kind: BlockKind; message: EngineMessage } | null {
  const status = document?.status ?? null;
  const headers = document?.headers ?? {};
  const signals = facts.inspection?.blockSignals;
  const markers = signals?.markers ?? [];
  // A CAPTCHA widget or iframe on a page with content of its own (a contact form, an invisible
  // reCAPTCHA, an ad) is not a wall: only a page that is little more than the challenge is.
  const content = signals !== undefined && (signals.login.mainContent || signals.login.wordsOutsideForms >= CONTENT_WORDS);
  const strong = content ? [] : markers.filter((m) => STRONG_MARKER.test(m));
  const challengeCookies = (signals?.cookieNames ?? []).filter((n) => CHALLENGE_COOKIE.test(n));

  // 1. HTTP_AUTH
  const auth = headers["www-authenticate"];
  if (status === 401 && auth !== undefined && /^\s*(basic|digest)\b/i.test(auth)) return { kind: "HTTP_AUTH", message: msg("blockHttpAuth", { scheme: auth.trim().split(/\s+/)[0] ?? "" }) };

  // 2. BOT_CHALLENGE
  if (strong.length > 0) return { kind: "BOT_CHALLENGE", message: msg("blockChallenge", { markers: strong.join(", ") }) };
  if (/challenge/i.test(headers["cf-mitigated"] ?? "")) return { kind: "BOT_CHALLENGE", message: msg("blockCloudflare") };
  if (status !== null && [401, 403, 429, 503].includes(status) && (markers.length > 0 || headers["x-datadome"] !== undefined || (challengeCookies.length > 0 && /cloudflare|akamai/i.test(headers.server ?? "")))) {
    return {
      kind: "BOT_CHALLENGE",
      message: msg("blockChallengeSignals", { status: String(status), signals: [...markers, ...challengeCookies.map((c) => `cookie ${c}`), ...(headers["x-datadome"] === undefined ? [] : ["x-datadome"])].join(", ") }),
    };
  }

  // 3–4. SESSION_EXPIRED / LOGIN_WALL
  const login = loginWall(facts, document);
  if (login !== null) return facts.sessionUsed === true ? { kind: "SESSION_EXPIRED", message: msg("blockSessionExpired", { detail: login }) } : { kind: "LOGIN_WALL", message: login };

  // 5. CONSENT_WALL
  const consent = signals?.consent ?? null;
  if (consent !== null && ((consent.vendor !== null && consent.coverage >= 0.3) || (consent.coverage >= 0.5 && consent.scrollLocked))) {
    return { kind: "CONSENT_WALL", message: msg("blockConsent", { vendor: consent.vendor ?? "none", coverage: Math.round(consent.coverage * 100), locked: consent.scrollLocked ? "yes" : "no" }) };
  }

  // 6. RATE_LIMITED
  if (status === 429 || (status === 503 && headers["retry-after"] !== undefined)) {
    return { kind: "RATE_LIMITED", message: msg("blockRateLimited", { status: String(status), retry: headers["retry-after"] ?? "none" }) };
  }

  // 7. FORBIDDEN
  if (status === 403) return { kind: "FORBIDDEN", message: msg("blockForbidden") };
  if (status === 451) return { kind: "FORBIDDEN", message: msg("blockLegal") };
  return null;
}

/**
 * A login wall only if (1) a non-login URL ended on a login route, or (2) the
 * page is mainly a login form (visible password field, little else, no main
 * content), or (3) a 401 without WWW-Authenticate. Inspecting a login URL
 * itself is never a wall; a login box next to visible content is not either.
 */
function loginWall(facts: VisitFacts, document: Document | undefined): EngineMessage | null {
  if (isLoginUrl(facts.requestedUrl)) return null;
  if (document !== undefined && isLoginUrl(document.url) && samePlace(facts.requestedUrl, document.url) === false) return msg("loginRedirected", { url: document.url });
  const login = facts.inspection?.blockSignals.login;
  if (login !== undefined && login.visiblePassword && login.wordsOutsideForms < 60 && !login.mainContent) return msg("loginForm");
  if (document?.status === 401 && document.headers["www-authenticate"] === undefined) return msg("login401");
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

function networkRestriction(message: string, requested: string): EngineMessage | null {
  let host: string;
  try {
    host = new URL(requested).hostname;
  } catch {
    return null;
  }
  if (/ERR_PROXY|ERR_TUNNEL/i.test(message)) return msg("netProxy", { message: message.slice(0, 120) });
  if (/ERR_NAME_NOT_RESOLVED/i.test(message) && !/^[\d.:[\]]+$/.test(host)) return msg("netDns", { host });
  if (PRIVATE_HOST.test(host) && /ERR_CONNECTION|ERR_ADDRESS|ERR_TIMED_OUT/i.test(message)) return msg("netPrivate", { host });
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

function block(kind: BlockKind, message: EngineMessage, document: Document | undefined, facts: VisitFacts, headers: Record<string, string>, retry: number | null = null): BlockInfo {
  return {
    kind,
    detail: englishOf(message),
    message,
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
  // The page's own navigations: an ad's or a widget's iframe is not the page.
  const navigations = network.exchanges.filter((x) => x.request.isNavigation && x.request.mainFrame !== false && x.request.resourceType === "document" && x.response !== undefined);
  const final = navigations.filter((x) => (x.response?.status ?? 0) < 300 || (x.response?.status ?? 0) >= 400).at(-1) ?? navigations.at(-1);
  if (final?.response === undefined) return undefined;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(final.response.headers)) headers[k.toLowerCase()] = v;
  return { status: final.response.status, url: final.request.url, headers };
}
