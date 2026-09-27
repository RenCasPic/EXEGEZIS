import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SearchHit, SearchReport } from "@exegezis/core";
import { z } from "zod";
import { writeJsonFile } from "./store.js";

/*
 * Review marks (docs/10-search.md §5): Relevante / No relevante / Pendiente
 * per hit, in review.json next to the report. The report itself is never
 * modified: it stays the evidence, and it still re-derives on load.
 */

export const ReviewMark = z.enum(["relevant", "not-relevant", "pending"]);
export type ReviewMark = z.infer<typeof ReviewMark>;

export const REVIEW_LABEL: Record<ReviewMark, string> = { relevant: "Relevante", "not-relevant": "No relevante", pending: "Pendiente" };

export const ReviewFile = z.strictObject({
  schemaVersion: z.literal("exegezis.search-review/v1"),
  marks: z.record(z.string().regex(/^H-[0-9a-f]{12}$/), ReviewMark),
  updatedAt: z.string().nullable(),
});
export type ReviewFile = z.infer<typeof ReviewFile>;

export const REVIEW_FILE = "review.json";

export async function readReview(searchDir: string): Promise<ReviewFile> {
  try {
    const parsed = ReviewFile.safeParse(JSON.parse(await readFile(join(searchDir, REVIEW_FILE), "utf8")));
    if (parsed.success) return parsed.data;
  } catch {
    // no marks yet
  }
  return { schemaVersion: "exegezis.search-review/v1", marks: {}, updatedAt: null };
}

export async function setReviewMark(searchDir: string, report: Pick<SearchReport, "hits">, hitId: string, mark: ReviewMark): Promise<ReviewFile> {
  if (!report.hits.some((h) => h.id === hitId)) throw new Error(`There is no hit ${hitId} in this search.`);
  const review = await readReview(searchDir);
  const next: ReviewFile = { ...review, marks: { ...review.marks, [hitId]: mark }, updatedAt: new Date().toISOString() };
  await writeJsonFile(join(searchDir, REVIEW_FILE), next);
  return next;
}

export function markOf(review: ReviewFile, hit: Pick<SearchHit, "id">): ReviewMark {
  return review.marks[hit.id] ?? "pending";
}

// ---------------------------------------------------------------------------
// «Solo lo nuevo»: this run against the previous run of the same saved search
// ---------------------------------------------------------------------------

export type Novelty = "new" | "same";

export interface Comparison {
  previousId: string;
  novelty: Map<string, Novelty>;
  /** Hits of the previous run that are no longer found. */
  gone: SearchHit[];
}

/** Hits are compared by key: the same page, the same term and the same quote (normalized). */
export function compareSearches(current: Pick<SearchReport, "hits">, previous: Pick<SearchReport, "id" | "hits">): Comparison {
  const before = new Set(previous.hits.map((h) => h.key));
  const now = new Set(current.hits.map((h) => h.key));
  return {
    previousId: previous.id,
    novelty: new Map(current.hits.map((h) => [h.id, before.has(h.key) ? "same" : "new"])),
    gone: previous.hits.filter((h) => !now.has(h.key)),
  };
}
