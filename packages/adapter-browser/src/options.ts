import { Viewport } from "@exegezis/core";
import { z } from "zod";

/**
 * Browser adapter configuration. Every field is recorded in the run metadata
 * and hashed into `configHash`. Locale and timezone are pinned by default:
 * leaving them to the host machine is a classic source of "works on my
 * machine" differences between two runs of the same plan.
 */
export const BrowserAdapterOptions = z.strictObject({
  browser: z.literal("chromium").default("chromium"),
  headless: z.boolean().default(true),
  viewport: Viewport.default({ width: 1280, height: 720 }),
  locale: z.string().default("en-US"),
  timezoneId: z.string().default("UTC"),
  actionTimeoutMs: z.int().positive().default(10_000),
  navigationTimeoutMs: z.int().positive().default(30_000),
  /** Max wait for network idle before an observation; not reaching it is recorded, not fatal. */
  settleTimeoutMs: z.int().nonnegative().default(3_000),
  trace: z.boolean().default(true),
  /** Capture request/response bodies of fetch/XHR calls (redacted). */
  captureBodies: z.boolean().default(true),
  maxBodyBytes: z.int().nonnegative().default(64 * 1024),
});
export type BrowserAdapterOptions = z.infer<typeof BrowserAdapterOptions>;
export type BrowserAdapterOptionsInput = z.input<typeof BrowserAdapterOptions>;
