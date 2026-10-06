import { fingerprintOf, type InspectionObservation, type PageLayout } from "@exegezis/core";
import { pageEvidence, type Check, type PageEvidence } from "./types.js";

/*
 * Checks of how a page works on a phone or a tablet: pure functions of the
 * layout facts measured on the page (adapter-browser LAYOUT_FACTS_SCRIPT).
 * They run on mobile and tablet visits only; on desktop they find nothing.
 */

function layoutOf(e: PageEvidence): PageLayout | null {
  return e.device === "desktop" ? null : e.inspection.layout;
}

const evidence = (e: PageEvidence, what: string) => pageEvidence(e, [{ kind: "dom", path: `${e.runPath}/inspection.json`, ref: "layout", description: what }]);

export const mobileScroll: Check = {
  id: "mobile-scroll",
  version: "1.0.0",
  description: "The page is wider than a phone's screen: it scrolls sideways",
  severity: "serious",
  run(e) {
    const layout = layoutOf(e);
    if (layout === null || layout.scrollWidth <= layout.viewport.width + 1) return [];
    const extra = Math.round(layout.scrollWidth - layout.viewport.width);
    const culprits = layout.overflowing.map((o) => o.selector);
    return [
      {
        fingerprint: fingerprintOf(this.id, "page"),
        title: "The page scrolls sideways on a small screen",
        detail: `The page is ${Math.round(layout.scrollWidth)} px wide on a ${Math.round(layout.viewport.width)} px screen (${extra} px too wide).${culprits.length > 0 ? ` What sticks out: ${culprits.join(", ")}.` : ""}`,
        severity: "serious",
        thirdParty: false,
        evidence: evidence(e, "Page and screen widths, and what sticks out"),
        assertion: null,
      },
    ];
  },
};

export const mobileTapTargets: Check = {
  id: "mobile-tap-targets",
  version: "1.0.0",
  description: "Touch targets smaller than 24×24 px (WCAG 2.2, 2.5.8)",
  severity: "moderate",
  run(e) {
    const layout = layoutOf(e);
    if (layout === null) return [];
    return layout.smallTargets.map(
      (t): InspectionObservation => ({
        fingerprint: fingerprintOf(this.id, t.selector),
        title: `Touch target smaller than 24×24 px: ${t.text === "" ? t.selector : `«${t.text}»`}`.slice(0, 200),
        detail: `${t.selector} is ${t.width}×${t.height} px; WCAG 2.2 (2.5.8, Target Size Minimum) asks for at least 24×24 px, or enough space around it.`,
        severity: "moderate",
        thirdParty: false,
        evidence: evidence(e, "Size of the touch target"),
        assertion: null,
      }),
    );
  },
};

export const mobileTextSize: Check = {
  id: "mobile-text-size",
  version: "1.0.0",
  description: "Text too small to read on a phone (under 12 px)",
  severity: "minor",
  run(e) {
    const layout = layoutOf(e);
    if (layout === null || layout.smallText.count === 0) return [];
    const samples = layout.smallText.samples.map((s) => `${s.selector} (${s.fontSize} px: «${s.text}»)`);
    return [
      {
        fingerprint: fingerprintOf(this.id, "page"),
        title: `Text under 12 px in ${layout.smallText.count} place${layout.smallText.count === 1 ? "" : "s"}`,
        detail: `Text this small is hard to read on a phone without zooming. For example: ${samples.join("; ")}.`,
        severity: "minor",
        thirdParty: false,
        evidence: evidence(e, "Text and its size"),
        assertion: null,
      },
    ];
  },
};

export const mobileViewport: Check = {
  id: "mobile-viewport",
  version: "1.0.0",
  description: "The meta viewport is missing or keeps people from zooming",
  severity: "serious",
  run(e) {
    const layout = layoutOf(e);
    if (layout === null) return [];
    const { content, blocksZoom } = layout.metaViewport;
    if (content === null) {
      return [
        {
          fingerprint: fingerprintOf(this.id, "missing"),
          title: "No meta viewport: phones show the desktop page shrunk",
          detail: 'The page has no <meta name="viewport">, so a phone lays it out as a desktop page about 980 px wide and shrinks it. Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
          severity: "serious",
          thirdParty: false,
          evidence: evidence(e, "The meta viewport"),
          assertion: { kind: "existence", target: { css: 'meta[name="viewport"]' }, expected: "present" },
        },
      ];
    }
    if (!blocksZoom) return [];
    return [
      {
        fingerprint: fingerprintOf(this.id, "blocks-zoom"),
        title: "The meta viewport keeps people from zooming",
        detail: `The meta viewport is «${content}»: user-scalable=no or a maximum-scale under 2 stops people from zooming the text to 200 % (WCAG 1.4.4, Resize Text).`,
        severity: "serious",
        thirdParty: false,
        evidence: evidence(e, "The meta viewport"),
        assertion: null,
      },
    ];
  },
};

/** Fixed or sticky elements covering more than this share of a phone's screen. */
const COVERED_LIMIT = 0.3;

export const mobileFixedOverlap: Check = {
  id: "mobile-fixed-overlap",
  version: "1.0.0",
  description: "Fixed or sticky elements cover a large part of the screen",
  severity: "moderate",
  run(e) {
    const layout = layoutOf(e);
    if (layout === null || layout.fixed.coveredShare <= COVERED_LIMIT) return [];
    const parts = layout.fixed.elements.map((f) => `${f.selector} (${f.position}, ${Math.round(f.share * 100)} %)`);
    return [
      {
        fingerprint: fingerprintOf(this.id, "page"),
        title: `Fixed elements cover ${Math.round(layout.fixed.coveredShare * 100)} % of the screen`,
        detail: `On a ${Math.round(layout.viewport.width)}×${Math.round(layout.viewport.height)} px screen, fixed or sticky elements cover ${Math.round(layout.fixed.coveredShare * 100)} % and hide the content underneath: ${parts.join(", ")}.`,
        severity: "moderate",
        thirdParty: false,
        evidence: evidence(e, "Fixed and sticky elements"),
        assertion: null,
      },
    ];
  },
};

export const MOBILE_CHECKS: readonly Check[] = [mobileScroll, mobileTapTargets, mobileTextSize, mobileViewport, mobileFixedOverlap];
