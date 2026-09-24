import { createRequire } from "node:module";
import type { Adapter, AdapterContext, AdapterDescriptor, AdapterSession } from "@exegezis/core";
import { chromium, type Browser } from "playwright";
import { BrowserAdapterOptions, type BrowserAdapterOptionsInput } from "./options.js";
import { BrowserSession } from "./session.js";

const require = createRequire(import.meta.url);
const PLAYWRIGHT_VERSION = (require("playwright/package.json") as { version: string }).version;
const ADAPTER_VERSION = (require("../package.json") as { version: string }).version;

export const BROWSER_ADAPTER_DESCRIPTOR: AdapterDescriptor = {
  id: "browser",
  version: ADAPTER_VERSION,
  description: "Web applications in Chromium, driven by Playwright",
  capabilities: ["browser", "dom", "accessibility", "network", "console", "page_errors", "screenshots", "trace"],
  actions: ["navigate", "click", "fill", "press", "wait", "screenshot"],
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
      browser = await chromium.launch({ headless: options.headless });
      const context = await browser.newContext({
        viewport: options.viewport,
        locale: options.locale,
        timezoneId: options.timezoneId,
      });
      context.setDefaultTimeout(options.actionTimeoutMs);
      context.setDefaultNavigationTimeout(options.navigationTimeoutMs);
      if (options.trace) {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      }
      const page = await context.newPage();
      const userAgent = await page.evaluate(() => navigator.userAgent);

      const environment = {
        adapter: { id: this.descriptor.id, version: this.descriptor.version },
        browser: {
          name: "chromium",
          version: browser.version(),
          userAgent,
          headless: options.headless,
          viewport: options.viewport,
        },
        automation: { name: "playwright", version: PLAYWRIGHT_VERSION },
      };
      // The session attaches its listeners before any navigation happens.
      const session = new BrowserSession(browser, context, page, options, recorder, log, environment, options.trace);
      const event = recorder.emit("ADAPTER_STARTED", "adapter", {
        adapterId: this.descriptor.id,
        details: {
          browser: "chromium",
          browserVersion: environment.browser.version,
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
