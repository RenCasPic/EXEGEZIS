import { fingerprintOf, type EvidenceRef } from "@exegezis/core";
import { pageEvidence, type Check } from "./types.js";

/** axe-core, WCAG 2.1 A/AA rules: one observation per rule and violating node. Severity is axe's impact. */
export const a11y: Check = {
  id: "a11y",
  version: "1.0.0",
  description: "Accessibility violations (axe-core, WCAG 2.1 A/AA)",
  severity: "moderate",
  run(e) {
    const axe = e.inspection.axe;
    if (axe === null) return [];
    const highlight: EvidenceRef[] =
      e.inspection.highlight === null
        ? []
        : [{ kind: "screenshot", path: `${e.runPath}/${e.inspection.highlight}`, description: "Violating elements outlined" }];
    return axe.violations.flatMap((v) =>
      v.nodes.map((n) => ({
        fingerprint: fingerprintOf(this.id, `${v.id} ${n.selector}`),
        title: `${v.help} (${v.id}): ${n.selector}`.slice(0, 200),
        detail: `${n.summary}\n\n${n.html}\n\nRule: ${v.helpUrl} · axe-core ${axe.version}`,
        severity: v.impact ?? this.severity,
        thirdParty: false,
        evidence: pageEvidence(e, [...highlight, { kind: "inspection", path: `${e.runPath}/inspection.json`, description: "axe-core results" }]),
        assertion: { kind: "a11y", rule: v.id, selector: n.selector, expected: "no_violation" },
      })),
    );
  },
};
