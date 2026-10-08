import { sameSite } from "@exegezis/adapter-browser";
import { fingerprintOf, type EvidenceRef } from "@exegezis/core";
import { pageEvidence, type Check } from "./types.js";

/** Markup that ads and Google inject into the page itself (auto ads, annotations, GPT slots). */
const INJECTED = /google-anno|goog-rentries|goog-|adsbygoogle|div-gpt-ad|gpt-ad|google_ads_iframe|\bins\.adsbygoogle/i;

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/**
 * Another site's content: a node inside an iframe from another site (a cookie banner, a chat, a
 * video, an ad), or markup ads inject into the page. Reported apart, as an external service.
 */
export function thirdPartyNode(node: { selector: string; frameUrl: string | null }, page: string): boolean {
  if (node.frameUrl !== null && /^https?:/.test(node.frameUrl) && !sameSite(host(node.frameUrl), host(page))) return true;
  return INJECTED.test(node.selector);
}

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
        thirdParty: thirdPartyNode(n, e.page),
        evidence: pageEvidence(e, [...highlight, { kind: "inspection", path: `${e.runPath}/inspection.json`, description: "axe-core results" }]),
        assertion: { kind: "a11y", rule: v.id, selector: n.selector, expected: "no_violation" },
      })),
    );
  },
};
