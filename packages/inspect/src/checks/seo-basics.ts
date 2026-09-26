import { fingerprintOf, type InspectionObservation } from "@exegezis/core";
import { pageEvidence, type Check } from "./types.js";

/** Basic metadata: title, lang, viewport, a single h1. Informational only. */
export const seoBasics: Check = {
  id: "seo-basics",
  version: "1.0.0",
  description: "Basic metadata: title, lang, meta viewport and one h1 (info)",
  severity: "info",
  run(e) {
    const { meta } = e.inspection;
    const evidence = pageEvidence(e, [{ kind: "inspection", path: `${e.runPath}/inspection.json`, description: "Page metadata" }]);
    const out: InspectionObservation[] = [];
    const add = (key: string, title: string, detail: string, assertion: InspectionObservation["assertion"]) =>
      out.push({ fingerprint: fingerprintOf(this.id, key), title, detail, severity: "info", thirdParty: false, evidence, assertion });
    if (meta.title.trim() === "") {
      add("title", "The page has no title", "document.title is empty.", { kind: "text", target: { css: "head > title" }, operator: "matches", expected: "\\S" });
    }
    if (meta.lang === null || meta.lang.trim() === "") {
      add("lang", "The html element has no lang attribute", "<html> has no lang attribute.", {
        kind: "attribute",
        target: { css: "html" },
        name: "lang",
        operator: "matches",
        expected: "\\S",
      });
    }
    if (meta.viewport === null) {
      add("viewport", "The page has no meta viewport", 'No <meta name="viewport"> element.', { kind: "existence", target: { css: 'meta[name="viewport"]' }, expected: "present" });
    }
    if (meta.h1Count !== 1) {
      add(`h1-${meta.h1Count === 0 ? "none" : "many"}`, meta.h1Count === 0 ? "The page has no h1" : `The page has ${meta.h1Count} h1 elements`, `Found ${meta.h1Count} <h1>.`, {
        kind: "count",
        target: { css: "h1" },
        expected: 1,
      });
    }
    return out;
  },
};
