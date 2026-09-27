import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { SearchQuery, ulid } from "@exegezis/core";
import { z } from "zod";
import { DEFAULT_MAX_COST_USD, DEFAULT_SEARCH_MODEL, PRICES } from "./cost.js";

/*
 * Search data that belongs to the person, not to a run (docs/10-search.md §5):
 * settings (cost limit, model), saved searches and their own templates. Kept
 * outside runs/ and outside the repository, next to the saved access.
 */

export function searchDataDir(): string {
  const configured = process.env["EXEGEZIS_SEARCH_DIR"];
  if (configured !== undefined && configured !== "") return configured;
  switch (platform()) {
    case "win32":
      return join(process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "EXEGEZIS", "search");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "EXEGEZIS", "search");
    default:
      return join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "exegezis", "search");
  }
}

async function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return fallback;
  }
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`${path} is not valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  return parsed.data;
}

/** Atomic write: a crash never leaves half a file. */
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SearchSettings = z.strictObject({
  maxCostUsd: z.number().positive().max(100).default(DEFAULT_MAX_COST_USD),
  model: z
    .string()
    .refine((m) => PRICES[m] !== undefined, "unknown model: it has no price, so the limit could not be enforced")
    .default(DEFAULT_SEARCH_MODEL),
});
export type SearchSettings = z.infer<typeof SearchSettings>;

export async function readSearchSettings(dir = searchDataDir()): Promise<SearchSettings> {
  return readJson(join(dir, "settings.json"), SearchSettings, SearchSettings.parse({}));
}

export async function writeSearchSettings(patch: Partial<SearchSettings>, dir = searchDataDir()): Promise<SearchSettings> {
  const next = SearchSettings.parse({ ...(await readSearchSettings(dir)), ...patch });
  await writeJsonFile(join(dir, "settings.json"), next);
  return next;
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------

export const SavedSearchOptions = z.strictObject({
  maxPages: z.int().positive().nullable(),
  maxDepth: z.int().nonnegative().nullable(),
  runs: z.int().positive().nullable(),
  includeHidden: z.boolean(),
  noSession: z.boolean(),
});

export const SavedSearch = z.strictObject({
  id: z.string(),
  name: z.string().min(1).max(200),
  url: z.string(),
  query: SearchQuery,
  options: SavedSearchOptions,
  createdAt: z.string(),
  lastRunAt: z.string().nullable(),
});
export type SavedSearch = z.infer<typeof SavedSearch>;

const SavedFile = z.strictObject({ schemaVersion: z.literal("exegezis.saved-searches/v1"), searches: z.array(SavedSearch) });

export async function listSavedSearches(dir = searchDataDir()): Promise<SavedSearch[]> {
  return (await readJson(join(dir, "saved.json"), SavedFile, { schemaVersion: "exegezis.saved-searches/v1", searches: [] })).searches;
}

async function writeSaved(searches: SavedSearch[], dir: string): Promise<void> {
  await writeJsonFile(join(dir, "saved.json"), { schemaVersion: "exegezis.saved-searches/v1", searches });
}

export async function saveSearch(input: Omit<SavedSearch, "id" | "createdAt" | "lastRunAt">, dir = searchDataDir()): Promise<SavedSearch> {
  const all = await listSavedSearches(dir);
  const saved = SavedSearch.parse({ ...input, id: ulid(), createdAt: new Date().toISOString(), lastRunAt: null });
  await writeSaved([...all, saved], dir);
  return saved;
}

export async function savedSearch(id: string, dir = searchDataDir()): Promise<SavedSearch | null> {
  return (await listSavedSearches(dir)).find((s) => s.id === id) ?? null;
}

export async function touchSavedSearch(id: string, at = new Date().toISOString(), dir = searchDataDir()): Promise<void> {
  const all = await listSavedSearches(dir);
  await writeSaved(
    all.map((s) => (s.id === id ? { ...s, lastRunAt: at } : s)),
    dir,
  );
}

export async function deleteSavedSearch(id: string, dir = searchDataDir()): Promise<boolean> {
  const all = await listSavedSearches(dir);
  const rest = all.filter((s) => s.id !== id);
  if (rest.length === all.length) return false;
  await writeSaved(rest, dir);
  return true;
}
