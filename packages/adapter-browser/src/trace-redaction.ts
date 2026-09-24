import { isSensitiveHeader, REDACTED, type SecretRegistry } from "@exegezis/core";
import { unzipSync, zipSync, type Zippable } from "fflate";

export interface TraceSanitizeResult {
  data: Uint8Array;
  /** Text entries that were rewritten. */
  entriesModified: number;
  /** Text entries scanned for leftover secrets after sanitizing. */
  entriesScanned: number;
  /** Binary entries (images) that cannot be scanned. */
  entriesSkipped: number;
  /** Tracked secret values still present after sanitizing (should be 0). */
  leaks: number;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

/**
 * Redacts a Playwright trace archive.
 *
 * Playwright traces record raw network headers, cookies and action
 * parameters (including values typed into inputs). The trace file layout is
 * internal to Playwright, so this does not depend on it: it walks every JSON
 * line looking for generic shapes (`{name, value}` header pairs with a
 * sensitive name, `cookies` arrays), then scrubs every text entry of all
 * secret values tracked during the run, and finally re-scans to verify.
 */
export function sanitizeTraceArchive(archive: Uint8Array, registry: SecretRegistry): TraceSanitizeResult {
  const entries = unzipSync(archive);
  const output: Zippable = {};
  let entriesModified = 0;
  let entriesScanned = 0;
  let entriesSkipped = 0;
  let leaks = 0;

  // Two passes: structural redaction first discovers new secret values (e.g. a
  // cookie only present in the trace), which the scrub pass then removes from
  // every entry.
  const texts = new Map<string, string>();
  for (const [name, bytes] of Object.entries(entries)) {
    const text = decodeText(bytes);
    if (text === undefined) {
      output[name] = bytes;
      entriesSkipped++;
      continue;
    }
    texts.set(name, redactJsonLines(text, registry));
  }

  for (const [name, redacted] of texts) {
    const scrubbed = registry.scrub(redacted);
    const original = entries[name];
    const changed = original === undefined || decodeText(original) !== scrubbed;
    output[name] = changed ? encoder.encode(scrubbed) : (original ?? encoder.encode(scrubbed));
    if (changed) entriesModified++;
    entriesScanned++;
    leaks += registry.countLeaks(scrubbed);
  }

  return { data: zipSync(output), entriesModified, entriesScanned, entriesSkipped, leaks };
}

function decodeText(bytes: Uint8Array): string | undefined {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/** Redacts JSON lines in place; non-JSON lines are returned unchanged. */
function redactJsonLines(text: string, registry: SecretRegistry): string {
  let changedAny = false;
  const lines = text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return line;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return line;
    }
    const state = { changed: false };
    const redacted = redactNode(parsed, registry, state, undefined);
    if (!state.changed) return line;
    changedAny = true;
    return JSON.stringify(redacted);
  });
  return changedAny ? lines.join("\n") : text;
}

function redactNode(
  node: unknown,
  registry: SecretRegistry,
  state: { changed: boolean },
  parentKey: string | undefined,
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => redactNode(item, registry, state, parentKey));
  }
  if (node === null || typeof node !== "object") return node;

  const record = node as Record<string, unknown>;
  const name = record["name"];
  const value = record["value"];
  if (typeof name === "string" && typeof value === "string" && value !== REDACTED) {
    if (parentKey === "cookies") {
      registry.add(value);
      state.changed = true;
      return { ...record, value: REDACTED };
    }
    if (isSensitiveHeader(name)) {
      registry.addHeaderValue(name, value);
      state.changed = true;
      return { ...record, value: REDACTED };
    }
  }

  const result: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(record)) {
    result[key] = redactNode(member, registry, state, key);
  }
  return result;
}
