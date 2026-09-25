import { readFile, stat } from "node:fs/promises";
import type { z } from "zod";

/**
 * The result of reading one artifact. A file that exists but does not match
 * its schema is reported as such, never shown as if it were valid.
 */
export type Loaded<T> =
  | { status: "ok"; value: T }
  | { status: "missing" }
  | { status: "invalid"; issues: string[] };

export async function readArtifact<S extends z.ZodType>(path: string, schema: S): Promise<Loaded<z.output<S>>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { status: "missing" };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { status: "invalid", issues: [`not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      status: "invalid",
      issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`),
    };
  }
  return { status: "ok", value: parsed.data };
}

export function valueOf<T>(loaded: Loaded<T>): T | null {
  return loaded.status === "ok" ? loaded.value : null;
}

/** Reads a text artifact (spec, log...) with a size cap. */
export async function readText(path: string, maxBytes = 512 * 1024): Promise<string | null> {
  try {
    const info = await stat(path);
    const text = await readFile(path, "utf8");
    return info.size > maxBytes ? `${text.slice(0, maxBytes)}\n… (truncated: ${info.size} bytes)` : text;
  } catch {
    return null;
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
