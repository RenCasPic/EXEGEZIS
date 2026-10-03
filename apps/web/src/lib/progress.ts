/*
 * How far a running inspection (or search) is, from its progress.json, for the
 * job page's bar: the whole job, not just the pages of the current repetition.
 * - robots.txt: no figure yet (the bar moves without a number);
 * - crawl / repeat: the pages of every repetition, up to 90 %;
 * - specs, search, AI: 95 %; done: 100 %.
 */

export interface ProgressFigures {
  phase: string;
  run: number;
  runs: number;
  pagesDone: number;
  pagesPlanned: number;
}

/** 0–100, or null while there is nothing to count yet. */
export function jobPercent(p: ProgressFigures): number | null {
  if (p.phase === "done") return 100;
  if (p.phase === "specs" || p.phase === "search" || p.phase === "ai") return 95;
  if (p.phase !== "crawl" && p.phase !== "repeat") return null;
  const runs = Math.max(1, p.runs);
  const run = Math.min(Math.max(1, p.run), runs);
  const pages = p.pagesPlanned > 0 ? Math.min(1, Math.max(0, p.pagesDone) / p.pagesPlanned) : 0;
  const share = (run - 1 + pages) / runs;
  return share === 0 ? null : Math.min(90, Math.round(share * 90));
}
