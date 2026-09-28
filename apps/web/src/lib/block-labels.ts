import type { BlockKind } from "@exegezis/core";

/*
 * What each block kind offers the person (docs/09-access.md §1). The words
 * (title, explanation, window button) are in the catalog: access.block.<KIND>.
 */

export type BlockSolution = "window" | "http-auth" | "waf-token" | "relaunch" | "none";

export const BLOCK_SOLUTIONS: Record<BlockKind, BlockSolution[]> = {
  HTTP_AUTH: ["http-auth"],
  BOT_CHALLENGE: ["waf-token", "window"],
  SESSION_EXPIRED: ["window"],
  LOGIN_WALL: ["window"],
  CONSENT_WALL: ["window"],
  RATE_LIMITED: ["relaunch"],
  FORBIDDEN: ["waf-token"],
  NETWORK_RESTRICTED: ["none"],
};

/** Kinds whose window button has its own wording (access.block.<KIND>.window). */
export const WINDOW_BUTTON_KINDS: readonly BlockKind[] = ["LOGIN_WALL", "SESSION_EXPIRED", "CONSENT_WALL", "BOT_CHALLENGE"];
