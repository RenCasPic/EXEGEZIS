import { fingerprintOf, normalizeMessage } from "@exegezis/core";
import { pageEvidence, sameOrigin, stableFragment, type Check } from "./types.js";

/** Uncaught JavaScript exceptions (page errors). */
export const jsExceptions: Check = {
  id: "js-exceptions",
  version: "1.0.0",
  description: "Uncaught JavaScript exceptions raised by the page",
  severity: "serious",
  run(e) {
    return e.console.pageErrors.map((error) => {
      const text = `${error.name}: ${error.message}`;
      const thirdParty = error.location !== undefined && !sameOrigin(error.location.url, e.origin);
      return {
        fingerprint: fingerprintOf(this.id, normalizeMessage(text)),
        title: `Uncaught ${text}`.slice(0, 200),
        detail: error.stack?.split("\n").slice(0, 4).join("\n") ?? text,
        severity: thirdParty ? "minor" : this.severity,
        thirdParty,
        evidence: pageEvidence(e, [{ kind: "console", path: `${e.runPath}/console.json`, ref: error.id, description: "The page error" }]),
        assertion: { kind: "page_error", contains: stableFragment(error.message) || error.name, expected: "absent" },
      };
    });
  },
};
