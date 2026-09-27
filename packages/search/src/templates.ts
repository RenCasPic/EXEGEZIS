import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExactQuery, MeaningQuery, TemplateQuery } from "@exegezis/core";
import { z } from "zod";
import { searchDataDir, writeJsonFile } from "./store.js";

/*
 * Search templates (docs/10-search.md §5): the repository's, versioned in
 * packages/search/templates, and the person's own, kept outside runs/. A
 * template has an exact part, a meaning part, or both; a template with only
 * an exact part never calls a model.
 */

export const SearchTemplate = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/, "use lowercase letters, digits and dashes"),
  version: z.int().positive(),
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  exact: z
    .strictObject({
      terms: z.array(z.string().min(1)).default([]),
      phrases: z.array(z.string().min(1)).default([]),
      excluded: z.array(z.string().min(1)).default([]),
      variants: z.boolean().default(false),
      regex: z.string().nullable().default(null),
      detectors: z.array(z.enum(["email", "phone", "past-date"])).default([]),
    })
    .nullable()
    .default(null),
  meaning: z.strictObject({ description: z.string().min(3) }).nullable().default(null),
});
export type SearchTemplate = z.infer<typeof SearchTemplate> & { origin: "repository" | "user" };
export type SearchTemplateInput = z.input<typeof SearchTemplate>;

/** packages/search/templates (EXEGEZIS_SEARCH_TEMPLATES_DIR overrides it). Resolved from this file, not as a bundler asset. */
export function repositoryTemplatesDir(): string {
  const configured = process.env["EXEGEZIS_SEARCH_TEMPLATES_DIR"];
  if (configured !== undefined && configured !== "") return configured;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "templates");
}

async function loadDir(dir: string, origin: "repository" | "user"): Promise<SearchTemplate[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out: SearchTemplate[] = [];
  for (const name of names) {
    const parsed = SearchTemplate.safeParse(JSON.parse(await readFile(join(dir, name), "utf8")));
    // A broken user template is skipped, not fatal; a broken repository template fails the tests.
    if (parsed.success) out.push({ ...parsed.data, origin });
  }
  return out;
}

export function userTemplatesDir(dataDir = searchDataDir()): string {
  return join(dataDir, "templates");
}

export async function listTemplates(dataDir = searchDataDir()): Promise<SearchTemplate[]> {
  const repo = await loadDir(repositoryTemplatesDir(), "repository");
  const user = (await loadDir(userTemplatesDir(dataDir), "user")).filter((t) => !repo.some((r) => r.id === t.id));
  return [...repo, ...user];
}

export async function findTemplate(id: string, dataDir = searchDataDir()): Promise<SearchTemplate | null> {
  return (await listTemplates(dataDir)).find((t) => t.id === id) ?? null;
}

export function isDeterministic(t: Pick<SearchTemplate, "meaning">): boolean {
  return t.meaning === null;
}

/** The template as a query; `withMeaning: false` runs only its exact part (no model). */
export function templateQuery(t: SearchTemplate, options: { withMeaning: boolean }): TemplateQuery {
  const exact =
    t.exact === null
      ? null
      : ExactQuery.parse({ kind: "exact", ...t.exact, excludeScope: "block", suggested: [] });
  const meaning = t.meaning === null || !options.withMeaning ? null : MeaningQuery.parse({ kind: "meaning", description: t.meaning.description });
  if (exact === null && meaning === null) throw new Error(`The template "${t.name}" has nothing to run without its meaning part.`);
  return TemplateQuery.parse({ kind: "template", id: t.id, version: t.version, name: t.name, origin: t.origin, exact, meaning });
}

export async function saveUserTemplate(input: SearchTemplateInput, dataDir = searchDataDir()): Promise<SearchTemplate> {
  const t = SearchTemplate.parse(input);
  const repo = await loadDir(repositoryTemplatesDir(), "repository");
  if (repo.some((r) => r.id === t.id)) throw new Error(`"${t.id}" is a repository template: choose another id.`);
  if (t.exact === null && t.meaning === null) throw new Error("A template needs an exact part, a meaning part, or both.");
  await writeJsonFile(join(userTemplatesDir(dataDir), `${t.id}.json`), t);
  return { ...t, origin: "user" };
}

export async function deleteUserTemplate(id: string, dataDir = searchDataDir()): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(id)) throw new Error("invalid template id");
  await rm(join(userTemplatesDir(dataDir), `${id}.json`), { force: true });
}
