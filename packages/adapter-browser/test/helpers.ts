import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { unzipSync } from "fflate";

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

/**
 * Returns every place a value occurs in a run directory, looking inside
 * zip archives (the trace) as well. Used to prove secrets never leak.
 */
export function findInRun(runDir: string, values: readonly string[]): string[] {
  const hits: string[] = [];
  const scan = (label: string, bytes: Uint8Array): void => {
    const text = Buffer.from(bytes).toString("latin1");
    for (const value of values) if (text.includes(value)) hits.push(`${label}: ${value}`);
  };
  for (const file of listFiles(runDir)) {
    const bytes = readFileSync(file);
    const label = relative(runDir, file);
    if (file.endsWith(".zip")) {
      for (const [entry, content] of Object.entries(unzipSync(bytes))) scan(`${label}!${entry}`, content);
    } else {
      scan(label, bytes);
    }
  }
  return hits;
}
