import type { ConsoleMessageEvidence, Device, NetworkExchangeEvidence, PageErrorEvidence, PageInspectionFile } from "@exegezis/core";
import type { PageEvidence } from "../src/index.js";

/** Synthetic evidence for one page, for the unit tests of the checks. */
export function evidence(patch: {
  page?: string;
  depth?: number;
  device?: Device;
  messages?: Partial<ConsoleMessageEvidence>[];
  pageErrors?: Partial<PageErrorEvidence>[];
  exchanges?: { method?: string; url: string; status?: number; failure?: string; isNavigation?: boolean; resourceType?: string; responseHeaders?: Record<string, string>; bytes?: number; ttfbMs?: number; mainFrame?: boolean }[];
  inspection?: Partial<PageInspectionFile>;
  links?: PageEvidence["links"];
}): PageEvidence {
  const page = patch.page ?? "https://site.test/";
  const origin = new URL(page).origin;
  const at = "2026-09-25T00:00:00.000Z";
  return {
    page,
    origin,
    depth: patch.depth ?? 0,
    run: 1,
    device: patch.device ?? "desktop",
    runPath: "pages/run-1/R",
    console: {
      schemaVersion: "exegezis.console/v1",
      messages: (patch.messages ?? []).map((m, i) => ({ kind: "console_message", id: `con-${i}`, timestamp: at, level: "error", apiType: "error", text: "", ...m })),
      pageErrors: (patch.pageErrors ?? []).map((e, i) => ({ kind: "page_error", id: `err-${i}`, timestamp: at, name: "Error", message: "", ...e })),
    },
    network: {
      schemaVersion: "exegezis.network/v1",
      exchanges: (patch.exchanges ?? []).map(
        (x, i): NetworkExchangeEvidence => ({
          kind: "network_exchange",
          id: `net-${i}`,
          request: { timestamp: at, method: x.method ?? "GET", url: x.url, resourceType: x.resourceType ?? "fetch", isNavigation: x.isNavigation ?? false, ...(x.mainFrame === undefined ? {} : { mainFrame: x.mainFrame }), headers: {} },
          ...(x.status === undefined ? {} : { response: { timestamp: at, status: x.status, statusText: "", headers: x.responseHeaders ?? {}, fromServiceWorker: false } }),
          ...(x.failure === undefined ? {} : { failure: { timestamp: at, errorText: x.failure } }),
          ...(x.bytes === undefined ? {} : { sizes: { body: x.bytes, headers: 300 } }),
          ...(x.ttfbMs === undefined ? {} : { ttfbMs: x.ttfbMs }),
        }),
      ),
    },
    inspection: {
      schemaVersion: "exegezis.page-inspection/v1",
      url: page,
      settled: { network: true, dom: true },
      meta: { title: "Page", lang: "en", viewport: "width=device-width", h1Count: 1, protocol: new URL(page).protocol, cspMeta: null, referrerMeta: null },
      links: [],
      axe: null,
      axeError: null,
      highlight: null,
      blockSignals: { markers: [], passwordField: false, login: { visiblePassword: false, wordsOutsideForms: 200, mainContent: true, otherForms: 0 }, consent: null, cookieNames: [] },
      blockedWrites: [],
      layout: null,
      performance: null,
      setCookies: [],
      ...patch.inspection,
    },
    observations: null,
    links: patch.links ?? [],
    hasTrace: false,
  };
}
