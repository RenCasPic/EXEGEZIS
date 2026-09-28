import type { HitVerdict, SearchStatus } from "@exegezis/core";
import type { Tone } from "./evidence/stages";

/*
 * Tones of search statuses and hit verdicts. Their words are in the catalogs:
 * labels.status.<CODE> (the pill), searches.statusText.<CODE> and
 * searches.verdictHelp.<VERDICT>.
 */

export const SEARCH_STATUS_TONE: Record<SearchStatus, Tone> = {
  COMPLETED: "ok",
  PARTIAL: "warn",
  BLOCKED: "warn",
  UNREACHABLE: "q",
  TIMEOUT: "q",
  ENGINE_ERROR: "bad",
  COST_LIMIT: "warn",
  AI_ERROR: "bad",
};

export const VERDICT_TONE: Record<HitVerdict, Tone> = { VERIFIED: "ok", INTERMITTENT: "q", SUGGESTED_QUOTE_VERIFIED: "warn" };

/** Where a hit sits: a key of searches.place. */
export function placeKey(h: { blockKind: string; visible: boolean }): "metadata" | "attribute" | "attributeHidden" | "visible" | "hidden" {
  if (h.blockKind === "meta-title" || h.blockKind === "meta-description" || h.blockKind === "og") return "metadata";
  if (h.blockKind === "alt" || h.blockKind === "title-attr" || h.blockKind === "aria-label") return h.visible ? "attribute" : "attributeHidden";
  return h.visible ? "visible" : "hidden";
}
