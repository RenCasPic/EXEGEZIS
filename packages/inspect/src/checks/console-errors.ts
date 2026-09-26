import { fingerprintOf, normalizeMessage } from "@exegezis/core";
import { pageEvidence, sameOrigin, stableFragment, type Check } from "./types.js";

/**
 * Console errors logged by the page. Chromium's own "Failed to load resource"
 * and "Mixed Content" lines are left to failed-requests and mixed-content, so
 * one problem is one finding.
 */
export const consoleErrors: Check = {
  id: "console-errors",
  version: "1.0.0",
  description: "Errors logged to the console by the page",
  severity: "moderate",
  run(e) {
    return e.console.messages
      .filter((m) => m.level === "error" && !/^Failed to load resource/i.test(m.text) && !/Mixed Content/i.test(m.text))
      .map((m) => {
        const thirdParty = m.location !== undefined && m.location.url !== "" && !sameOrigin(m.location.url, e.origin);
        return {
          fingerprint: fingerprintOf(this.id, normalizeMessage(m.text)),
          title: `Console error: ${m.text}`.slice(0, 200),
          detail: m.location === undefined ? m.text : `${m.text}\n  at ${m.location.url}:${m.location.line}`,
          severity: thirdParty ? "minor" : this.severity,
          thirdParty,
          evidence: pageEvidence(e, [{ kind: "console", path: `${e.runPath}/console.json`, ref: m.id, description: "The console message" }]),
          assertion: { kind: "console", level: "error", contains: stableFragment(m.text), expected: "absent" },
        };
      });
  },
};
