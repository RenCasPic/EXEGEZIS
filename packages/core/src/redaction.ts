import { REDACTED } from "./schemas/action.js";

export { REDACTED };

/** Bumped whenever the rules below change, and recorded in every run. */
export const REDACTION_POLICY = "exegezis.redaction/v1";

/** Header names that always carry credentials. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-access-token",
  "x-refresh-token",
  "x-csrf-token",
  "x-xsrf-token",
  "x-amz-security-token",
]);

/** Header name segments that suggest a credential, e.g. `x-session-token`. */
const SENSITIVE_HEADER_PATTERN =
  /(^|[-_])(token|secret|password|passwd|apikey|api-key|api_key|session|signature|credential)s?([-_]|$)/i;

/** Object keys / query parameters whose values are credentials or PII. */
const SENSITIVE_KEY_PATTERN =
  /^(pass(word|wd|phrase)?|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|auth|authorization|api[-_]?key|apikey|x[-_]api[-_]key|cookie|session[-_]?(id|token)?|sid|jwt|bearer|private[-_]?key|otp|pin|cvv|cvc|card[-_]?number|credit[-_]?card|ssn)$/i;

/**
 * Values shorter than this are not tracked as secrets: replacing every
 * occurrence of e.g. "1" or "abc" across artifacts would corrupt evidence.
 */
export const MIN_TRACKED_SECRET_LENGTH = 6;

export function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return SENSITIVE_HEADERS.has(lower) || SENSITIVE_HEADER_PATTERN.test(lower);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key) || /(password|secret|token|api[-_]?key)/i.test(key);
}

/**
 * Collects literal secret values seen during a run (header values, cookie
 * values, sensitive form input, sensitive JSON fields) so they can be scrubbed
 * from *any* artifact, including ones where they appear in unexpected places
 * (a console message that prints a token, a trace, a log line).
 *
 * This is a second line of defense. Structural redaction (by header name or
 * JSON key) is the first.
 */
export class SecretRegistry {
  private readonly values = new Set<string>();

  add(value: string | undefined | null): void {
    if (value === undefined || value === null) return;
    const trimmed = value.trim();
    if (trimmed.length >= MIN_TRACKED_SECRET_LENGTH && trimmed !== REDACTED) {
      this.values.add(trimmed);
    }
  }

  /**
   * Tracks a value the user explicitly declared secret (e.g. a sensitive
   * form fill). Bypasses the minimum length: a short password is still a
   * password. Only empty values are ignored.
   */
  addExplicit(value: string): void {
    if (value.length > 0 && value !== REDACTED) this.values.add(value);
  }

  /** Tracks a credential header value plus its meaningful parts. */
  addHeaderValue(name: string, value: string): void {
    const lower = name.toLowerCase();
    if (lower === "cookie") {
      for (const pair of value.split(";")) this.add(cookieValue(pair));
      return;
    }
    if (lower === "set-cookie") {
      // Playwright joins multiple Set-Cookie headers with newlines.
      for (const line of value.split("\n")) this.add(cookieValue(line.split(";")[0] ?? ""));
      return;
    }
    this.add(value);
    // "Bearer <token>", "Basic <b64>": track the credential part on its own.
    const match = /^\s*[A-Za-z][\w-]*\s+(\S+)\s*$/.exec(value);
    if (match?.[1] !== undefined) this.add(match[1]);
  }

  get size(): number {
    return this.values.size;
  }

  /** Replaces every tracked secret with the redaction marker. */
  scrub(text: string): string {
    if (this.values.size === 0) return text;
    let result = text;
    // Longest first so a secret that contains another is fully replaced.
    for (const value of [...this.values].sort((a, b) => b.length - a.length)) {
      if (result.includes(value)) result = result.split(value).join(REDACTED);
    }
    return result;
  }

  /** Number of tracked secret values still present in `text`. */
  countLeaks(text: string): number {
    let leaks = 0;
    for (const value of this.values) {
      if (text.includes(value)) leaks++;
    }
    return leaks;
  }
}

function cookieValue(pair: string): string {
  const index = pair.indexOf("=");
  return index === -1 ? "" : pair.slice(index + 1).trim();
}

export function redactHeaders(
  headers: Readonly<Record<string, string>>,
  registry: SecretRegistry,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveHeader(name)) {
      registry.addHeaderValue(name, value);
      result[name] = REDACTED;
    } else {
      result[name] = value;
    }
  }
  return result;
}

/** Redacts credentials in the userinfo part and sensitive query parameters. */
export function redactUrl(url: string, registry: SecretRegistry): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return registry.scrub(url);
  }
  if (parsed.password !== "") {
    registry.add(decodeURIComponent(parsed.password));
    parsed.password = REDACTED;
  }
  let changed = parsed.password !== "";
  for (const key of [...new Set(parsed.searchParams.keys())]) {
    if (isSensitiveKey(key)) {
      for (const value of parsed.searchParams.getAll(key)) registry.add(value);
      parsed.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? parsed.toString() : url;
}

/**
 * Redacts a request/response body. JSON and form-encoded bodies are redacted
 * structurally by key; anything else is only scrubbed of known secret values.
 */
export function redactBody(text: string, mediaType: string, registry: SecretRegistry): string {
  const type = mediaType.toLowerCase();
  if (type.includes("json")) {
    try {
      const parsed: unknown = JSON.parse(text);
      return JSON.stringify(redactValue(parsed, registry));
    } catch {
      return registry.scrub(text);
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    for (const key of [...new Set(params.keys())]) {
      if (isSensitiveKey(key)) {
        for (const value of params.getAll(key)) registry.add(value);
        params.set(key, REDACTED);
      }
    }
    return params.toString();
  }
  return registry.scrub(text);
}

/** Deeply redacts values stored under sensitive keys, tracking them as secrets. */
export function redactValue(value: unknown, registry: SecretRegistry): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, registry));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      if (isSensitiveKey(key) && member !== null && typeof member !== "object") {
        registry.add(String(member));
        result[key] = REDACTED;
      } else {
        result[key] = redactValue(member, registry);
      }
    }
    return result;
  }
  return value;
}
