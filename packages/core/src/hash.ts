import { createHash } from "node:crypto";

/**
 * Serializes a JSON-compatible value with object keys sorted recursively, so
 * that semantically equal values always produce the same string (and hash).
 * `undefined` object members are dropped, matching JSON.stringify.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const member = (value as Record<string, unknown>)[key];
      if (member !== undefined) {
        sorted[key] = sortKeys(member);
      }
    }
    return sorted;
  }
  return value;
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** `sha256:<hex>` of the canonical JSON form of `value`. */
export function hashJson(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}
