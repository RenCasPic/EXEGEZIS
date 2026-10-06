/**
 * The checks `exegezis inspect` knows (packages/inspect/src/checks; their
 * names: home.form.inspect.checkLabel.<id>). The UI
 * does not import the inspector (it would pull a browser into the web
 * server); a test keeps this list equal to the real registry.
 */
export const INSPECT_CHECKS = [
  { id: "js-exceptions" },
  { id: "console-errors" },
  { id: "failed-requests" },
  { id: "broken-links" },
  { id: "a11y" },
  { id: "mixed-content" },
  { id: "seo-basics" },
  { id: "mobile-scroll" },
  { id: "mobile-tap-targets" },
  { id: "mobile-text-size" },
  { id: "mobile-viewport" },
  { id: "mobile-fixed-overlap" },
] as const;

/** --devices values (the CLI's; their names: common.device.<id>). */
export const DEVICE_IDS = ["desktop", "mobile", "tablet"] as const;
export type DeviceId = (typeof DEVICE_IDS)[number];

/** --browser-channel values (the CLI's; their names: common.browserChannel.<id>). */
export const BROWSER_CHANNEL_IDS = ["auto", "chromium", "chrome", "msedge"] as const;
export type BrowserChannelId = (typeof BROWSER_CHANNEL_IDS)[number];

/** Defaults of the CLI, shown as chips on the form. */
export const INSPECT_DEFAULTS = { maxPages: 20, maxDepth: 2, runs: 3, devices: ["desktop", "mobile"] as DeviceId[] } as const;

/** Loopback targets never need the permission confirmation. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}
