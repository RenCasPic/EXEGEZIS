import { fingerprintOf } from "@exegezis/core";
import { pageEvidence, portableUrl, type Check } from "./types.js";

/** Internal links whose target answers >= 400 or cannot be reached. External links are listed, never checked. */
export const brokenLinks: Check = {
  id: "broken-links",
  version: "1.0.0",
  description: "Internal links that answer 4xx/5xx or cannot be reached",
  severity: "serious",
  run(e) {
    return e.links
      // 405: the address exists, for another method (an API endpoint listed as a link): not broken.
      .filter((l) => l.checked && (l.error !== null || (l.status !== null && l.status >= 400 && l.status !== 405)))
      .map((l) => {
        const outcome = l.error ?? String(l.status);
        const text = e.inspection.links.find((a) => a.href.replace(/#.*$/, "") === l.url)?.text ?? "";
        return {
          fingerprint: fingerprintOf(this.id, `${l.url} ${l.error !== null ? "error" : outcome}`),
          title: `Broken link to ${new URL(l.url).pathname} (${outcome})`,
          detail: `The page links to ${l.url}${text === "" ? "" : ` ("${text}")`}, which ${l.error !== null ? `could not be reached: ${l.error}` : `answers ${outcome}`}.`,
          severity: this.severity,
          thirdParty: false,
          evidence: pageEvidence(e, [{ kind: "inspection", path: `${e.runPath}/inspection.json`, description: "Links found on the page" }]),
          assertion: { kind: "link", url: portableUrl(l.url, e.origin), expected: "ok" },
        };
      });
  },
};
