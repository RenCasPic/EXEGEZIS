import { fingerprintOf, normalizePageUrl, type Severity } from "@exegezis/core";
import { pageEvidence, portableUrl, sameOrigin, type Check } from "./types.js";

/**
 * Requests of the page that answered >= 400 or failed at the network level.
 * Not counted: requests blocked by --strict-readonly (the inspection's own
 * doing), requests the browser cancelled (ERR_ABORTED), and the document of
 * a page reached through a link (that is a broken link, reported once, from
 * the page that links to it).
 */
export const failedRequests: Check = {
  id: "failed-requests",
  version: "1.0.0",
  description: "Requests that answered 4xx/5xx or failed",
  severity: "serious",
  run(e) {
    return e.network.exchanges.flatMap((x) => {
      if (x.request.isNavigation && (e.depth > 0 || normalizePageUrl(x.request.url) !== e.page)) return [];
      const failure = x.failure?.errorText;
      if (failure !== undefined && (/strict-readonly/.test(failure) || /ERR_ABORTED/.test(failure))) return [];
      const status = x.response?.status;
      if (failure === undefined && (status === undefined || status < 400)) return [];
      const thirdParty = !sameOrigin(x.request.url, e.origin);
      const severity: Severity = thirdParty ? "minor" : failure !== undefined || (status ?? 0) >= 500 ? "serious" : "moderate";
      const outcome = failure !== undefined ? failure.replace(/^net::/, "") : String(status);
      const url = x.request.url.replace(/#.*$/, "");
      return [
        {
          fingerprint: fingerprintOf(this.id, `${x.request.method} ${url.replace(/\?.*$/, "")} ${failure !== undefined ? "failed" : outcome}`),
          title: `${x.request.method} ${new URL(url).pathname} → ${outcome}`,
          detail: `${x.request.method} ${url} (${x.request.resourceType}) ${failure !== undefined ? `failed: ${failure}` : `answered ${status} ${x.response?.statusText ?? ""}`}`.trim(),
          severity,
          thirdParty,
          evidence: pageEvidence(e, [{ kind: "network", path: `${e.runPath}/network.json`, ref: x.id, description: "Request and response" }]),
          assertion: { kind: "request", request: { method: x.request.method as "GET", url: portableUrl(url, e.origin) }, expected: "ok" },
        },
      ];
    });
  },
};
