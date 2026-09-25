import { REDACTED } from "@exegezis/core";

/**
 * Redacts credentials and personal data from free text before it leaves the
 * machine (e.g. a symptom sent to an external model provider). Conservative
 * and pattern-based: it errs on the side of redacting.
 */
const PATTERNS: { name: string; pattern: RegExp }[] = [
  // Authorization / cookie headers pasted into an issue: only the value is
  // redacted, so the rest of the sentence survives.
  {
    name: "authorization-header",
    pattern: /\b(authorization|proxy-authorization)\s*[:=]\s*(bearer|basic|token|digest)?\s*[^\s,;]+/gi,
  },
  { name: "cookie-header", pattern: /\b(set-cookie|cookie)\s*[:=]\s*[^\s;,=]+=[^\s;,]+(;\s*[^\s;,=]+=[^\s;,]+)*/gi },
  { name: "bearer-token", pattern: /\bbearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  // key=value / key: value for secret-looking keys.
  {
    name: "secret-assignment",
    pattern: /\b(pass(word|wd|phrase)?|secret|token|api[-_]?key|access[-_]?key|client[-_]?secret|session[-_]?id)\s*[:=]\s*["']?[^\s"',;]+/gi,
  },
  // Well-known credential shapes.
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "provider-key", pattern: /\b(sk|pk|rk)[-_](live|test|ant|proj)?[-_]?[A-Za-z0-9_-]{16,}\b/g },
  { name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  // Credentials inside URLs.
  { name: "url-credentials", pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi },
  // Personal data.
  { name: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

export interface RedactionResult {
  text: string;
  /** Number of matches replaced, by pattern name. */
  redactions: Record<string, number>;
}

export function redactText(text: string): RedactionResult {
  const redactions: Record<string, number> = {};
  let result = text;
  for (const { name, pattern } of PATTERNS) {
    result = result.replace(pattern, (match: string, ...groups: unknown[]) => {
      redactions[name] = (redactions[name] ?? 0) + 1;
      if (name === "url-credentials") return `${String(groups[0])}${REDACTED}@`;
      const separator = /[:=]/.exec(match);
      // Keep "password:" so the reader knows what was there; drop the value.
      return separator !== null && name !== "bearer-token" && name !== "jwt"
        ? `${match.slice(0, separator.index + 1)} ${REDACTED}`
        : REDACTED;
    });
  }
  return { text: result, redactions };
}

export function redactionCount(result: RedactionResult): number {
  return Object.values(result.redactions).reduce((a, b) => a + b, 0);
}
