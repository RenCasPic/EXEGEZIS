import { createRequire } from "node:module";
import type { Adapter, AdapterContext, AdapterDescriptor, AdapterSession } from "@exegezis/core";
import type { Browser } from "playwright";
import { launchBrowser } from "./browsers.js";
import { SUPPORTED_ASSERTIONS } from "./assertions.js";
import { BrowserAdapterOptions, type BrowserAdapterOptionsInput } from "./options.js";
import { BrowserSession } from "./session.js";

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

export class BrowserAdapter implements Adapter {
  readonly descriptor = BROWSER_ADAPTER_DESCRIPTOR;
  readonly options: BrowserAdapterOptions;

  constructor(options: BrowserAdapterOptionsInput = {}) {
    this.options = BrowserAdapterOptions.parse(options);
  }

  get config(): Readonly<Record<string, unknown>> {
    return this.options;
  }

  async start({ recorder, logger }: AdapterContext): Promise<AdapterSession> {
    const log = logger.child({ component: "adapter-browser" });
    const { options } = this;
    let browser: Browser | undefined;
    try {
      const launched = await launchBrowser({ channel: options.browserChannel, headless: options.headless });
      browser = launched.browser;
      for (const a of launched.attempts) log.warn("browser candidate unavailable", { engine: a.engine, error: a.error });
      const context = await browser.newContext({
        viewport: options.viewport,
        locale: options.locale,
        timezoneId: options.timezoneId,
        ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
        ...(options.storageState === undefined ? {} : { storageState: options.storageState }),
        ...(options.ignoreHTTPSErrors ? { ignoreHTTPSErrors: true } : {}),
      });
      context.setDefaultTimeout(options.actionTimeoutMs);
      context.setDefaultNavigationTimeout(options.navigationTimeoutMs);
      if (options.trace) {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      }
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
      const session = new BrowserSession(browser, context, page, options, recorder, log, environment, options.trace);
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
