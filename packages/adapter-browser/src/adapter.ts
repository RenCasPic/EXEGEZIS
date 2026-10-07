import { createRequire } from "node:module";
import type { Adapter, AdapterContext, AdapterDescriptor, AdapterSession } from "@exegezis/core";
import type { Browser } from "playwright";
import { launchBrowser } from "./browsers.js";
import { SUPPORTED_ASSERTIONS } from "./assertions.js";
import { BrowserAdapterOptions, type BrowserAdapterOptionsInput } from "./options.js";
import { BrowserSession } from "./session.js";
import { PERF_OBSERVER_SCRIPT } from "./page-scripts.js";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = (require("playwright/package.json") as { version: string }).version;
const ADAPTER_VERSION = (require("../package.json") as { version: string }).version;

export const BROWSER_ADAPTER_DESCRIPTOR: AdapterDescriptor = {
  id: "browser",
  version: ADAPTER_VERSION,
  description: "Web applications in a Chromium-based browser (Playwright Chromium, Chrome or Edge), driven by Playwright",
  capabilities: ["browser", "dom", "accessibility", "network", "console", "page_errors", "screenshots", "trace"],
  actions: ["navigate", "click", "fill", "press", "wait", "screenshot"],
  assertions: SUPPORTED_ASSERTIONS,
  produces: ["console", "network", "accessibility", "observations", "screenshot", "trace"],
};

/**
 * Saved access for one origin (docs/09-access.md), decrypted in memory by
 * the caller. It is NOT part of the options: options are recorded in every
 * run's metadata; this never is. The config only says which kinds were used.
 */
export interface AdapterAccess {
  origin: string;
  storageState?: { cookies: { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: string }[]; origins: { origin: string; localStorage: { name: string; value: string }[] }[] };
  httpCredentials?: { username: string; password: string };
  /** Sent as X-Exegezis-Token, only to `origin`. */
  wafToken?: string;
}

export const WAF_TOKEN_HEADER = "x-exegezis-token";

function playwrightState(state: NonNullable<AdapterAccess["storageState"]>) {
  const sameSite = (v: string): "Strict" | "Lax" | "None" => (v === "Strict" || v === "None" ? v : "Lax");
  return { cookies: state.cookies.map((c) => ({ ...c, sameSite: sameSite(c.sameSite) })), origins: state.origins };
}

export class BrowserAdapter implements Adapter {
  readonly descriptor = BROWSER_ADAPTER_DESCRIPTOR;
  readonly options: BrowserAdapterOptions;
  readonly #access: AdapterAccess | null;

  constructor(options: BrowserAdapterOptionsInput = {}, access: AdapterAccess | null = null) {
    this.options = BrowserAdapterOptions.parse(options);
    this.#access = access;
  }

  get config(): Readonly<Record<string, unknown>> {
    const a = this.#access;
    return a === null ? this.options : { ...this.options, access: { session: a.storageState !== undefined, httpCredentials: a.httpCredentials !== undefined, wafToken: a.wafToken !== undefined } };
  }

  async start({ recorder, logger }: AdapterContext): Promise<AdapterSession> {
    const log = logger.child({ component: "adapter-browser" });
    const { options } = this;
    let browser: Browser | undefined;
    const access = this.#access;
    if (access !== null) {
      // Before anything is recorded: every artifact written as text is scrubbed of these values.
      for (const c of access.storageState?.cookies ?? []) recorder.secrets.add(c.value);
      for (const o of access.storageState?.origins ?? []) for (const item of o.localStorage) recorder.secrets.add(item.value);
      if (access.httpCredentials !== undefined) recorder.secrets.addExplicit(access.httpCredentials.password);
      if (access.wafToken !== undefined) recorder.secrets.addExplicit(access.wafToken);
    }
    try {
      const launched = await launchBrowser({ channel: options.browserChannel, headless: options.headless });
      browser = launched.browser;
      for (const a of launched.attempts) log.warn("browser candidate unavailable", { engine: a.engine, error: a.error });
      const context = await browser.newContext({
        viewport: options.viewport,
        isMobile: options.isMobile,
        hasTouch: options.hasTouch,
        deviceScaleFactor: options.deviceScaleFactor,
        locale: options.locale,
        timezoneId: options.timezoneId,
        ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
        ...(access?.storageState !== undefined ? { storageState: playwrightState(access.storageState) } : options.storageState === undefined ? {} : { storageState: options.storageState }),
        ...(access?.httpCredentials === undefined ? {} : { httpCredentials: { ...access.httpCredentials, origin: access.origin } }),
        ...(options.ignoreHTTPSErrors ? { ignoreHTTPSErrors: true } : {}),
      });
      const token = access?.wafToken;
      if (token !== undefined) {
        // Only to the authorized origin, never to third parties. Registered before
        // --strict-readonly's route so that one still runs first for writes.
        const origin = access?.origin;
        await context.route("**/*", async (route) => {
          if (new URL(route.request().url()).origin !== origin) {
            await route.fallback();
            return;
          }
          await route.fallback({ headers: { ...route.request().headers(), [WAF_TOKEN_HEADER]: token } });
        });
      }
      context.setDefaultTimeout(options.actionTimeoutMs);
      context.setDefaultNavigationTimeout(options.navigationTimeoutMs);
      if (options.trace) {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      }
      // Inspections measure the page's own performance: the observers go in before its scripts run.
      if (options.inspect) await context.addInitScript(PERF_OBSERVER_SCRIPT);
      const page = await context.newPage();
      if (options.coverage) await page.coverage.startJSCoverage({ resetOnNavigation: false });
      const userAgent = await page.evaluate(() => navigator.userAgent);

      const environment = {
        adapter: { id: this.descriptor.id, version: this.descriptor.version },
        browser: {
          name: launched.channel,
          channel: launched.channel,
          system: launched.system,
          version: launched.version,
          userAgent,
          headless: options.headless,
          viewport: options.viewport,
        },
        automation: { name: "playwright", version: PLAYWRIGHT_VERSION },
      };
      // The session attaches its listeners before any navigation happens.
      const session = new BrowserSession(browser, context, page, options, recorder, log, environment, options.trace, access !== null);
      if (options.blockPageWrites) await session.blockPageWrites();
      const event = recorder.emit("ADAPTER_STARTED", "adapter", {
        adapterId: this.descriptor.id,
        details: {
          browser: launched.channel,
          browserSystem: launched.system,
          browserVersion: environment.browser.version,
          ...(launched.attempts.length === 0 ? {} : { browserFallbackFrom: launched.attempts.map((a) => a.engine).join(", ") }),
          playwrightVersion: PLAYWRIGHT_VERSION,
          headless: options.headless,
          viewport: `${options.viewport.width}x${options.viewport.height}`,
        },
      });
      log.info("browser started", { version: environment.browser.version }, event.id);
      return session;
    } catch (error) {
      await browser?.close().catch(() => undefined);
      throw error;
    }
  }
}
