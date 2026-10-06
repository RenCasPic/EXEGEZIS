import { parseHex, type IssueGroup } from "@exegezis/core";
import AXE_HELP_ES from "@/i18n/axe-help-es.json";

/*
 * Findings and issue groups in the reader's language. The engine writes
 * their titles in English from fixed patterns; these functions reword only
 * those patterns (colours, ratios and the page's own messages stay as
 * recorded). axe rule descriptions come from axe-core's own Spanish locale
 * (src/i18n/axe-help-es.json, generated from axe-core/locales/es.json); the
 * rule name itself is never translated.
 */

/** A next-intl translator for the "inspections" namespace, loosely typed (keys come from data). */
export type InspectionsT = (key: never, values?: never) => string;

const say = (t: InspectionsT, key: string, values?: Record<string, string | number>) => t(key as never, values as never);

function hsl(hex: string): [number, number, number] | null {
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** A rough colour name ("gray", "dark blue", "almost white"…), always shown next to the hex. */
export function colorName(t: InspectionsT, hex: string): string {
  const v = hsl(hex);
  if (v === null) return say(t, "color.color");
  const [h, s, l] = v;
  if (l >= 0.97) return say(t, "color.white");
  if (l >= 0.92 && s < 0.6) return say(t, "color.nearWhite");
  if (l <= 0.06) return say(t, "color.black");
  const tone = l >= 0.72 ? "light" : l <= 0.3 ? "dark" : "none";
  const toned = (color: string) => say(t, "color.toned", { color: say(t, `color.${color}`), tone });
  if (s < 0.12) return toned("gray");
  if (s < 0.3) return toned(h >= 190 && h < 260 ? "bluishGray" : h >= 20 && h < 60 ? "warmGray" : "gray");
  const hue = h < 15 || h >= 345 ? "red" : h < 45 ? "orange" : h < 65 ? "yellow" : h < 170 ? "green" : h < 200 ? "cyan" : h < 255 ? "blue" : h < 290 ? "purple" : "pink";
  return toned(hue);
}

/** The axe rule's description in the reader's language (its id stays as it is). */
function axeHelp(locale: string, rule: string, recorded: string): string {
  return locale === "es" ? ((AXE_HELP_ES as Record<string, string>)[rule] ?? recorded) : recorded;
}

const SEO: Record<string, string> = {
  "The page has no title": "title.noTitle",
  "The html element has no lang attribute": "title.noLang",
  "The page has no meta viewport": "title.noViewport",
  "The page has no h1": "title.noH1",
};

/** A finding's title (as the engine wrote it) in the reader's language. */
export function findingTitle(t: InspectionsT, locale: string, checkId: string, title: string): string {
  let m: RegExpExecArray | null;
  switch (checkId) {
    case "console-errors":
      m = /^Console error: ([\s\S]*)$/.exec(title);
      return m === null ? title : say(t, "title.console", { text: m[1] ?? "" });
    case "js-exceptions":
      m = /^Uncaught exception: ([\s\S]*)$/.exec(title);
      if (m !== null) return say(t, "title.uncaughtException", { text: m[1] ?? "" });
      m = /^Uncaught ([\s\S]*)$/.exec(title);
      return m === null ? title : say(t, "title.uncaught", { text: m[1] ?? "" });
    case "broken-links":
      m = /^Broken link to (\S+) \((.*)\)$/.exec(title);
      return m === null ? title : say(t, "title.brokenLink", { path: m[1] ?? "", outcome: m[2] ?? "" });
    case "mixed-content":
      m = /^Mixed content \(blocked\): ([\s\S]*)$/.exec(title);
      if (m !== null) return say(t, "title.mixedBlocked", { url: m[1] ?? "" });
      m = /^Mixed content: ([\s\S]*)$/.exec(title);
      return m === null ? title : say(t, "title.mixed", { url: m[1] ?? "" });
    case "a11y":
      m = /^([\s\S]*) \(([a-z0-9-]+)\): ([\s\S]*)$/.exec(title);
      return m === null ? title : `${axeHelp(locale, m[2] ?? "", m[1] ?? "")} (${m[2]}): ${m[3]}`;
    case "seo-basics": {
      const key = SEO[title];
      if (key !== undefined) return say(t, key);
      m = /^The page has (\d+) h1 elements$/.exec(title);
      return m === null ? title : say(t, "title.manyH1", { count: Number(m[1]) });
    }
    case "mobile-scroll":
      return title === "The page scrolls sideways on a small screen" ? say(t, "title.mobileScroll") : title;
    case "mobile-tap-targets":
      m = /^Touch target smaller than 24×24 px: ([\s\S]*)$/.exec(title);
      return m === null ? title : say(t, "title.mobileTap", { target: m[1] ?? "" });
    case "mobile-text-size":
      m = /^Text under 12 px in (\d+) places?$/.exec(title);
      return m === null ? title : say(t, "title.mobileText", { count: Number(m[1]) });
    case "mobile-viewport":
      if (title.startsWith("No meta viewport")) return say(t, "title.mobileNoViewport");
      return title === "The meta viewport keeps people from zooming" ? say(t, "title.mobileZoom") : title;
    case "mobile-fixed-overlap":
      m = /^Fixed elements cover (\d+) % of the screen$/.exec(title);
      return m === null ? title : say(t, "title.mobileFixed", { percent: Number(m[1]) });
    default:
      return title;
  }
}

/** An issue group's title in the reader's language. */
export function groupTitle(t: InspectionsT, locale: string, g: Pick<IssueGroup, "checkId" | "title" | "contrast">): string {
  if (g.contrast !== null) {
    const c = g.contrast;
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    return say(t, "title.contrast", {
      fgName: colorName(t, c.foreground),
      fg: c.foreground.toUpperCase(),
      bgName: colorName(t, c.background),
      bg: c.background.toUpperCase(),
      ratio: number.format(c.ratio),
      required: number.format(c.required),
      large: c.textSize === "large" ? "yes" : "no",
    });
  }
  if (g.checkId === "failed-requests") return say(t, "title.failedRequest", { text: g.title });
  if (g.checkId === "a11y") return say(t, "title.a11yGroup", { text: findingTitle(t, locale, g.checkId, g.title) });
  return findingTitle(t, locale, g.checkId, g.title);
}
