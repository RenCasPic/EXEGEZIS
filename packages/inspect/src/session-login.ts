import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchBrowser, type AdapterAccess, type BrowserChannel } from "@exegezis/adapter-browser";
import { ulid, type BlockInfo } from "@exegezis/core";
import type { Page } from "playwright";
import { inspectSite, userAgentFor } from "./inspect.js";

/**
 * "Open a window to get access" (docs/09-access.md §3). A VISIBLE browser,
 * of the same channel and with the same User-Agent as the inspection, opens
 * the site; the person signs in, passes the verification or chooses in the
 * cookie banner. EXEGEZIS never types, reads the fields or keeps a password:
 * it exports the browser's final state (cookies and storage), and only if a
 * verification visit no longer finds the block.
 */
export interface CaptureAccessOptions {
  url: string;
  exegezisVersion: string;
  browserChannel?: BrowserChannel;
  /**
   * Waits for the person. Real use: resolves when they press "Done" (UI or
   * Enter) — closing the window also ends it. Tests: a script plays the person.
   */
  person: (page: Page) => Promise<void>;
  /** Access already saved for the origin (e.g. HTTP credentials) that the window should use too. */
  existing?: AdapterAccess | null;
  /** Tests only: the "visible" window runs headless. */
  headless?: boolean;
  timeoutMs?: number;
}

export type CaptureResult =
  | { ok: true; storageState: NonNullable<AdapterAccess["storageState"]>; finalUrl: string }
  | { ok: false; reason: string; block: BlockInfo | null };

export async function captureAccess(options: CaptureAccessOptions): Promise<CaptureResult> {
  const origin = new URL(options.url).origin;
  const launched = await launchBrowser({ channel: options.browserChannel ?? "auto", headless: options.headless === true });
  let storageState: NonNullable<AdapterAccess["storageState"]>;
  try {
    const context = await launched.browser.newContext({
      // The same identity as the inspection: nothing is disguised.
      userAgent: userAgentFor(options.exegezisVersion),
      ...(options.existing?.storageState === undefined ? {} : { storageState: options.existing.storageState as never }),
      ...(options.existing?.httpCredentials === undefined ? {} : { httpCredentials: { ...options.existing.httpCredentials, origin } }),
    });
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
    const closed = new Promise<void>((resolve) => {
      page.once("close", () => resolve());
      launched.browser.once("disconnected", () => resolve());
    });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, options.timeoutMs ?? 30 * 60_000));
    await Promise.race([options.person(page), closed, timeout]);
    try {
      storageState = await context.storageState();
    } catch {
      return { ok: false, reason: "The window was closed before EXEGEZIS could read the browser state. Nothing was saved; try again and press Done before closing it.", block: null };
    }
  } finally {
    await launched.browser.close().catch(() => undefined);
  }

  // Verification: a real, headless inspection visit with the new state. Saved only if the block is gone.
  const dir = await mkdtemp(join(tmpdir(), "exegezis-access-check-"));
  try {
    const report = await inspectSite({
      url: options.url,
      dir,
      id: ulid(),
      exegezisVersion: options.exegezisVersion,
      runs: 1,
      maxPages: 1,
      maxDepth: 0,
      delayMs: 0,
      ignoreRobots: true,
      checks: ["seo-basics"],
      ...(options.browserChannel === undefined ? {} : { browserChannel: options.browserChannel }),
      access: { ...(options.existing ?? {}), origin, storageState },
      strictReadonly: true,
    });
    const entry = report.pages.find((p) => p.depth === 0 && p.run === 1);
    // The state being checked is new, not a saved one that expired: a login wall here is still a LOGIN_WALL.
    const seen = entry?.block ?? null;
    const block = seen?.kind === "SESSION_EXPIRED" ? { ...seen, kind: "LOGIN_WALL" as const, detail: seen.detail.replace(/^the saved session no longer works: /, "") } : seen;
    if (entry === undefined || entry.status === "BLOCKED" || entry.status === "UNREACHABLE" || entry.status === "TIMEOUT") {
      return {
        ok: false,
        reason: block === null ? `the page is still not reachable (${entry?.status ?? "no visit"})` : `the block is still there: ${block.kind} — ${block.detail}`,
        block,
      };
    }
    return { ok: true, storageState, finalUrl: entry.finalUrl ?? options.url };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
