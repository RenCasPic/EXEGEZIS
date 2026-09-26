import { fingerprintOf, type InspectionObservation } from "@exegezis/core";
import { pageEvidence, type Check } from "./types.js";

/**
 * Mixed content on an HTTPS page: resources requested over plain HTTP.
 * Chromium blocks active mixed content before any request is made, so its
 * console report is the primary evidence; allowed passive content shows up
 * as an http: request.
 */
export const mixedContent: Check = {
  id: "mixed-content",
  version: "1.0.0",
  description: "Resources loaded over HTTP from an HTTPS page (mixed content)",
  severity: "serious",
  run(e) {
    if (e.inspection.meta.protocol !== "https:") return [];
    const found = new Map<string, InspectionObservation>();
    for (const m of e.console.messages) {
      if (!/Mixed Content/i.test(m.text)) continue;
      const url = /insecure [\w\s-]*'(http:[^']+)'/i.exec(m.text)?.[1] ?? /'(http:[^']+)'/.exec(m.text)?.[1];
      if (url === undefined || found.has(url)) continue;
      const blocked = /blocked/i.test(m.text);
      found.set(url, {
        fingerprint: fingerprintOf(this.id, url),
        title: `Mixed content${blocked ? " (blocked)" : ""}: ${url}`.slice(0, 200),
        detail: m.text,
        severity: blocked ? "serious" : "moderate",
        thirdParty: false,
        evidence: pageEvidence(e, [{ kind: "console", path: `${e.runPath}/console.json`, ref: m.id, description: "Browser mixed-content report" }]),
        assertion: { kind: "console", level: m.level === "warning" ? "warning" : "error", contains: url, expected: "absent" },
      });
    }
    for (const x of e.network.exchanges) {
      const url = x.request.url;
      if (!url.startsWith("http:") || found.has(url)) continue;
      found.set(url, {
        fingerprint: fingerprintOf(this.id, url),
        title: `Mixed content: ${url}`.slice(0, 200),
        detail: `The HTTPS page requested ${url} over plain HTTP (${x.request.resourceType}).`,
        severity: "moderate",
        thirdParty: false,
        evidence: pageEvidence(e, [{ kind: "network", path: `${e.runPath}/network.json`, ref: x.id, description: "The insecure request" }]),
        // Correct behaviour: nothing on the page references the insecure URL.
        assertion: { kind: "existence", target: { css: `[src="${url}"], [href="${url}"]` }, expected: "absent" },
      });
    }
    return [...found.values()];
  },
};
