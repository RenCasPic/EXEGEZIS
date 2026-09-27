"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { queryParts } from "@exegezis/core";
import {
  ceilCents,
  deleteSavedSearch,
  deleteUserTemplate,
  estimateSuggestCost,
  exactQueryFrom,
  listSavedSearches,
  readSearchSettings,
  ReviewMark,
  roughEstimateByPages,
  saveSearch,
  saveUserTemplate,
  setReviewMark,
  writeSearchSettings,
} from "@exegezis/search/light";
import { runCli } from "@/lib/access";
import { checkBrowser } from "@/lib/browser-check";
import { findSearch } from "@/lib/evidence/searches";
import { isLoopbackHost } from "@/lib/inspect-checks";
import { plannerCredentialsConfigured, startSearch, type StartSearchInput } from "@/lib/jobs";
import { SEARCH_DEFAULTS } from "@/lib/search-defaults";
import { parseSearchForm } from "@/lib/search-options";

/*
 * Search actions (docs/10-search.md §6). The web never calls a model itself:
 * searches and suggestions run in the CLI, like inspections. The web only
 * writes what belongs to the person: review marks, saved searches, their
 * templates and the search settings.
 */

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

export interface SearchState {
  error: string | null;
  remedy?: string[];
}

export async function startSearchAction(_prev: SearchState, form: FormData): Promise<SearchState> {
  const result = parseSearchForm({
    url: text(form, "url"),
    mode: text(form, "mode"),
    terms: text(form, "terms"),
    meaning: text(form, "meaning"),
    template: text(form, "template"),
    withMeaning: text(form, "withMeaning") === "on",
    variants: text(form, "variants") === "on",
    excludeScope: text(form, "excludeScope"),
    suggested: text(form, "suggested"),
    runs: text(form, "runs"),
    maxPages: text(form, "maxPages"),
    maxDepth: text(form, "maxDepth"),
    includeHidden: text(form, "includeHidden") === "on",
    noSession: text(form, "noSession") === "on",
    ignoreRobots: text(form, "ignoreRobots") === "on",
    browserChannel: text(form, "browserChannel"),
    save: text(form, "save"),
  });
  if (!result.ok) return { error: result.error };
  if (!isLoopbackHost(new URL(result.input.url).hostname) && text(form, "permission") !== "on") {
    return { error: "Confirma que tienes permiso para revisar este sitio." };
  }
  const usesModel = result.input.mode === "meaning" || (result.input.mode === "template" && result.input.withMeaning);
  if (usesModel && !(await plannerCredentialsConfigured())) {
    return { error: "La búsqueda por significado necesita la clave de la IA: añade EXEGEZIS_ANTHROPIC_API_KEY al archivo .env del repositorio. La búsqueda exacta y las plantillas sin IA funcionan sin ella." };
  }
  const browser = await checkBrowser(result.input.browserChannel);
  if (!browser.ok) return { error: browser.message, remedy: browser.remedy };
  let jobId: string;
  try {
    jobId = (await startSearch(result.input)).id;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  redirect(`/jobs/${jobId}`);
}

/** Before launching: an order of magnitude by number of pages (the exact estimate comes after reading them). */
export async function meaningEstimateAction(maxPages: number | null): Promise<{ usd: number; limitUsd: number; model: string; configured: boolean }> {
  const settings = await readSearchSettings();
  const pages = maxPages ?? SEARCH_DEFAULTS.maxPages;
  return { usd: ceilCents(roughEstimateByPages(settings.model, pages)), limitUsd: settings.maxCostUsd, model: settings.model, configured: await plannerCredentialsConfigured() };
}

export async function suggestEstimateAction(terms: string): Promise<{ usd: number; model: string; configured: boolean; terms: string[] } | { error: string }> {
  let list: string[];
  try {
    const q = exactQueryFrom({ terms });
    list = [...q.terms, ...q.phrases];
  } catch {
    return { error: "Escribe primero algún término." };
  }
  const settings = await readSearchSettings();
  return { usd: estimateSuggestCost(settings.model, list), model: settings.model, configured: await plannerCredentialsConfigured(), terms: list };
}

export interface Suggestion {
  term: string;
  from: string;
  relation: string;
}

/** «Sugerir términos relacionados»: the CLI asks the model; only the terms travel, never page text. */
export async function suggestAction(terms: string): Promise<{ suggestions: Suggestion[]; costUsd: number; model: string } | { error: string }> {
  const r = await runCli(["search", "suggest", "--terms", terms, "--json"]);
  if (r.code !== 0) return { error: (r.stderr.trim() || r.stdout.trim() || "No se pudieron pedir sugerencias.").replace(/^Error: /, "") };
  try {
    const parsed = JSON.parse(r.stdout) as { suggestions: Suggestion[]; costUsd: number; model: string };
    return { suggestions: parsed.suggestions, costUsd: parsed.costUsd, model: parsed.model };
  } catch {
    return { error: "La respuesta de las sugerencias no se pudo leer." };
  }
}

export async function reviewMarkAction(searchId: string, hitId: string, mark: string): Promise<{ error: string | null }> {
  const ref = await findSearch(searchId);
  const parsed = ReviewMark.safeParse(mark);
  if (ref === null || ref.report.status !== "ok" || !parsed.success) return { error: "No se encontró el resultado." };
  try {
    await setReviewMark(ref.dir, ref.report.value, hitId, parsed.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath(`/searches/${searchId}`);
  return { error: null };
}

/** Input to run again what a finished search ran (same query and options). */
function rerunInput(report: NonNullable<Awaited<ReturnType<typeof findSearch>>>["report"] & { status: "ok" }, patch: Partial<StartSearchInput>): StartSearchInput {
  const r = report.value;
  const q = r.query;
  const parts = queryParts(q);
  const exact = parts.exact;
  return {
    url: r.target.url,
    mode: q.kind,
    terms: exact === null || q.kind !== "exact" ? null : [...exact.terms, ...exact.phrases.map((p) => `"${p}"`), ...exact.excluded.map((e) => `-${e}`)].join(", "),
    meaning: q.kind === "meaning" ? q.description : null,
    template: q.kind === "template" ? q.id : null,
    withMeaning: q.kind === "template" && q.meaning !== null,
    variants: exact?.variants ?? false,
    excludeScope: exact?.excludeScope ?? "block",
    suggested: q.kind === "exact" ? q.suggested : [],
    runs: r.options.runs,
    maxPages: r.options.maxPages,
    maxDepth: r.options.maxDepth,
    includeHidden: r.options.includeHidden,
    noSession: false,
    ignoreRobots: r.options.ignoreRobots,
    browserChannel: "auto",
    maxCostUsd: null,
    saved: null,
    save: null,
    reuse: null,
    ...patch,
  };
}

/** COST_LIMIT: the person approves the estimate; the same pages are reused (the site is not visited again). */
export async function approveCostAction(form: FormData): Promise<void> {
  const ref = await findSearch(text(form, "search"));
  if (ref === null || ref.report.status !== "ok" || ref.report.value.ai === null) throw new Error("No se encontró la búsqueda.");
  const approved = ceilCents(ref.report.value.ai.estimateUsd);
  const job = await startSearch(rerunInput(ref.report, { maxCostUsd: approved, reuse: ref.dir }));
  redirect(`/jobs/${job.id}`);
}

/** «Repetir» from a finished search (a fresh visit of the site). */
export async function repeatSearchAction(form: FormData): Promise<void> {
  const ref = await findSearch(text(form, "search"));
  if (ref === null || ref.report.status !== "ok") throw new Error("No se encontró la búsqueda.");
  const saved = ref.report.value.savedSearchId;
  const job = await startSearch(rerunInput(ref.report, saved === null ? {} : { saved }));
  redirect(`/jobs/${job.id}`);
}

export async function saveSearchAction(form: FormData): Promise<void> {
  const ref = await findSearch(text(form, "search"));
  const name = text(form, "name").trim();
  if (ref === null || ref.report.status !== "ok" || name === "") throw new Error("Pon un nombre a la búsqueda.");
  const r = ref.report.value;
  await saveSearch({ name: name.slice(0, 200), url: r.target.url, query: r.query, options: { maxPages: r.options.maxPages, maxDepth: r.options.maxDepth, runs: r.options.runs, includeHidden: r.options.includeHidden, noSession: false } });
  redirect("/searches#guardadas");
}

export async function runSavedAction(form: FormData): Promise<void> {
  const id = text(form, "saved");
  const saved = (await listSavedSearches()).find((s) => s.id === id);
  if (saved === undefined) throw new Error("No se encontró la búsqueda guardada.");
  const job = await startSearch({
    url: saved.url,
    mode: saved.query.kind,
    terms: null,
    meaning: null,
    template: null,
    withMeaning: false,
    variants: false,
    excludeScope: "block",
    suggested: [],
    runs: null,
    maxPages: null,
    maxDepth: null,
    includeHidden: saved.options.includeHidden,
    noSession: saved.options.noSession,
    ignoreRobots: false,
    browserChannel: "auto",
    maxCostUsd: null,
    saved: saved.id,
    save: null,
    reuse: null,
  });
  redirect(`/jobs/${job.id}`);
}

export async function deleteSavedAction(form: FormData): Promise<void> {
  await deleteSavedSearch(text(form, "saved"));
  redirect("/searches#guardadas");
}

export interface SettingsState {
  error: string | null;
  done?: string;
}

export async function saveSearchSettingsAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const raw = text(form, "maxCostUsd").replace(",", ".");
  const maxCostUsd = Number(raw);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 100) return { error: "El límite debe ser un número de USD entre 0,01 y 100." };
  try {
    const s = await writeSearchSettings({ maxCostUsd: Math.round(maxCostUsd * 100) / 100, model: text(form, "model") });
    return { error: null, done: `Guardado: ${s.maxCostUsd.toFixed(2)} USD por búsqueda por significado, modelo ${s.model}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveTemplateAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const name = text(form, "name").trim();
  const id = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  const terms = text(form, "terms").trim();
  const meaning = text(form, "meaning").trim();
  if (name === "" || id.length < 2) return { error: "Pon un nombre a la plantilla." };
  if (terms === "" && meaning === "") return { error: "Una plantilla necesita términos, una descripción por significado, o ambos." };
  try {
    let exact = null;
    if (terms !== "") {
      const q = exactQueryFrom({ terms, variants: text(form, "variants") === "on" });
      exact = { terms: q.terms, phrases: q.phrases, excluded: q.excluded, variants: q.variants, regex: null, detectors: [] };
    }
    await saveUserTemplate({ id: `mi-${id}`, version: 1, name, description: text(form, "description").trim().slice(0, 1000), exact, meaning: meaning === "" ? null : { description: meaning } });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  revalidatePath("/settings/search");
  return { error: null, done: `Plantilla «${name}» guardada.` };
}

export async function deleteTemplateAction(form: FormData): Promise<void> {
  await deleteUserTemplate(text(form, "id"));
  redirect("/settings/search");
}
