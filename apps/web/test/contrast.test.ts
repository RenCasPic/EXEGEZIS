import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.1 contrast of the design tokens, read from globals.css itself so the
 * table in docs/08-design-system.md cannot drift from the code. Every pair
 * used for normal-size text must reach 4.5:1 (AA).
 */
const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}

const hex = (h: string): [number, number, number] => {
  const v = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
};
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Resolves a token to RGB; `color-mix(in srgb, var(--x) N%, transparent)` is composited over the panel. */
function rgb(tokens: Record<string, string>, name: string): [number, number, number] {
  const value = tokens[name];
  if (value === undefined) throw new Error(`missing token --${name}`);
  const mix = /color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, transparent\)/.exec(value);
  if (mix === null) return hex(value);
  const fg = rgb(tokens, mix[1] as string);
  const bg = rgb(tokens, "panel");
  const a = Number(mix[2]) / 100;
  return fg.map((c, i) => Math.round(c * a + (bg[i] as number) * (1 - a))) as [number, number, number];
}

const PAIRS: [string, string][] = [
  ["fg", "bg"],
  ["fg", "panel"],
  ["fg", "sunken"],
  ["fg", "hover"],
  ["heading", "bg"],
  ["heading", "panel"],
  ["muted", "sunken"],
  ["muted", "panel"],
  ["muted", "bg"],
  ["muted", "hover"],
  ["faint", "panel"],
  ["faint", "bg"],
  ["accent-text", "panel"],
  ["accent-text", "bg"],
  ["on-accent", "accent"],
  ["on-accent", "accent-hover"],
  ["ok", "ok-bg"],
  ["ok", "panel"],
  ["warn", "warn-bg"],
  ["warn", "panel"],
  ["q", "q-bg"],
  ["q", "panel"],
  ["off", "off-bg"],
  ["off", "panel"],
  ["bad", "bad-bg"],
  ["bad", "panel"],
];

describe("design tokens: WCAG AA contrast", () => {
  const themes = { light: block(":root"), dark: block('html[data-theme="dark"]') };

  for (const [theme, tokens] of Object.entries(themes)) {
    it(`${theme}: every text pair reaches 4.5:1`, () => {
      const failing = PAIRS.map(([fg, bg]) => ({ pair: `${fg}/${bg}`, ratio: contrast(rgb(tokens, fg), rgb(tokens, bg)) })).filter((p) => p.ratio < 4.5);
      expect(failing).toEqual([]);
    });
  }

  it("the no-script dark block matches the data-theme dark block", () => {
    const media = css.slice(css.indexOf("html:not([data-theme]) {"));
    const noScript = Object.fromEntries([...media.slice(0, media.indexOf("}")).matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], (m[2] as string).trim()]));
    expect(noScript).toEqual(themes.dark);
  });

  it("uses no purple and keeps the action colours (petrol, lime) for actions only", () => {
    expect(css).not.toMatch(/#6d42d9|#c9b3ff/i);
    for (const tokens of Object.values(themes)) {
      const actions = [tokens["accent"], tokens["accent-hover"]];
      for (const family of ["ok", "warn", "q", "off", "bad"]) expect(actions).not.toContain(tokens[family]);
    }
  });

  it("dark theme: navy with lime text and buttons and white headings (René's palette)", () => {
    const d = themes.dark;
    expect([d["bg"], d["panel"], d["fg"], d["heading"], d["accent"], d["on-accent"]]).toEqual(["#011b34", "#062443", "#d0db4e", "#ffffff", "#cddc39", "#011b34"]);
    expect(themes.light["heading"]).toBe(themes.light["fg"]);
  });

  it("nothing of the former warm ivory or blue brand is left", () => {
    expect(css).not.toMatch(/#f6f6f3|#e4e2da|#efede6|#d3d0c6|#ecebe6|#f0f0ed|#dddcd6|#2563eb|#1d4ed8|#7aa7ff|#2f6bed|#0b0c0f|#111318/i);
    for (const tokens of Object.values(themes)) {
      for (const name of ["panel-border", "panel-border-width", "panel-shadow", "field", "empty", "stripe", "off-bd", "heading"]) expect(tokens[name], name).toBeDefined();
    }
    expect(themes.light["accent"]).toBe("#0e7490");
  });

  it("panels have one outline: --panel-border-width of --panel-border and --panel-shadow (2 px light, 1.5 px lime dark)", () => {
    expect(css).toMatch(/@utility panel-frame \{\s*border: var\(--panel-border-width\) solid var\(--panel-border\);\s*box-shadow: var\(--panel-shadow\);\s*\}/);
    expect([themes.light["panel-border"], themes.light["panel-border-width"]]).toEqual(["#c7d3d8", "2px"]);
    expect([themes.dark["panel-border"], themes.dark["panel-border-width"]]).toEqual(["#d0db4e", "1.5px"]);
  });
});
