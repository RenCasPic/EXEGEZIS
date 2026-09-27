import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeSearch, ObservationsFile, type SearchHit, type SearchReport } from "@exegezis/core";
import { compareSearches, markOf, readReview, type Comparison, type ReviewFile, type ReviewMark } from "@exegezis/search/light";
import type { SearchRef } from "./discover";
import { getIndex } from "./investigations";

/*
 * Searches as the UI shows them (docs/10-search.md §6). Everything comes from
 * the report written by `exegezis search`; a report that does not re-derive
 * (hits, verdicts, quotes, coverage) is shown as invalid, never partially.
 * Review marks live apart, in review.json.
 */

export async function listSearches(): Promise<SearchRef[]> {
  return (await getIndex()).searches;
}

export async function findSearch(id: string): Promise<SearchRef | null> {
  return (await listSearches()).find((s) => s.id === id) ?? null;
}

/** The previous run of the same saved search, for «solo lo nuevo». */
export async function previousRun(ref: SearchRef): Promise<{ ref: SearchRef; report: SearchReport } | null> {
  if (ref.report.status !== "ok" || ref.report.value.savedSearchId === null) return null;
  const saved = ref.report.value.savedSearchId;
  for (const other of await listSearches()) {
    if (other.id >= ref.id || other.report.status !== "ok") continue;
    if (other.report.value.savedSearchId === saved) return { ref: other, report: other.report.value };
  }
  return null;
}

export async function loadReview(ref: SearchRef): Promise<ReviewFile> {
  return readReview(ref.dir);
}

export type VerdictFilter = "all" | "verified" | "intermittent" | "suggested";
export type MarkFilter = "all" | ReviewMark;

export interface HitFilters {
  verdict: VerdictFilter;
  mark: MarkFilter;
  onlyNew: boolean;
  group: "page" | "term";
  q: string;
}

export function parseHitFilters(params: Record<string, string | string[] | undefined>): HitFilters {
  const one = (k: string) => (typeof params[k] === "string" ? params[k] : "");
  const verdict = one("tipo");
  const mark = one("revision");
  return {
    verdict: verdict === "verificados" ? "verified" : verdict === "intermitentes" ? "intermittent" : verdict === "sugerencias" ? "suggested" : "all",
    mark: mark === "relevante" ? "relevant" : mark === "no-relevante" ? "not-relevant" : mark === "pendiente" ? "pending" : "all",
    onlyNew: one("nuevo") === "1",
    group: one("agrupar") === "termino" ? "term" : "page",
    q: one("q").trim(),
  };
}

export function filterHits(hits: readonly SearchHit[], f: HitFilters, review: ReviewFile, comparison: Comparison | null): SearchHit[] {
  const q = normalizeSearch(f.q);
  return hits.filter((h) => {
    if (f.verdict === "verified" && h.verdict !== "VERIFIED") return false;
    if (f.verdict === "intermittent" && h.verdict !== "INTERMITTENT") return false;
    if (f.verdict === "suggested" && h.verdict !== "SUGGESTED_QUOTE_VERIFIED") return false;
    if (f.mark !== "all" && markOf(review, h) !== f.mark) return false;
    if (f.onlyNew && comparison !== null && comparison.novelty.get(h.id) !== "new") return false;
    if (q !== "" && !normalizeSearch(`${h.page} ${h.quote} ${h.term ?? ""} ${h.reason ?? ""}`).includes(q)) return false;
    return true;
  });
}

/** Hits grouped by page or by what matched (term, or «por significado»). */
export function groupHits(hits: readonly SearchHit[], by: "page" | "term"): { key: string; hits: SearchHit[] }[] {
  const groups = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const key = by === "page" ? h.page : h.via === "meaning" ? "Por significado (IA)" : (h.term ?? "—");
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  return [...groups.entries()].map(([key, list]) => ({ key, hits: list })).sort((a, b) => b.hits.length - a.hits.length || a.key.localeCompare(b.key));
}

export { compareSearches };

/** Width and height of a PNG (its IHDR header), to crop the screenshot around a block. */
export async function pngSize(path: string): Promise<{ width: number; height: number } | null> {
  try {
    const head = await readFile(path);
    if (head.length < 24 || head.toString("latin1", 1, 4) !== "PNG") return null;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } catch {
    return null;
  }
}

export interface VisitShot {
  /** Path inside the search directory. */
  path: string;
  width: number;
  height: number;
}

/** The full-page screenshot of each visit (runPath → shot), read from its observations. */
export async function visitShots(ref: SearchRef, runPaths: readonly string[]): Promise<Map<string, VisitShot>> {
  const shots = new Map<string, VisitShot>();
  for (const runPath of new Set(runPaths)) {
    try {
      const parsed = ObservationsFile.safeParse(JSON.parse(await readFile(join(ref.dir, runPath, "observations.json"), "utf8")));
      const shot = parsed.success ? parsed.data.screenshots[0] : undefined;
      if (shot === undefined) continue;
      const path = `${runPath}/${shot.path}`;
      const size = await pngSize(join(ref.dir, path));
      if (size !== null) shots.set(runPath, { path, ...size });
    } catch {
      // no screenshot for this visit
    }
  }
  return shots;
}
