import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import { annualMonthly, annualTotal, PLANS } from "../content/pricing";
import en from "../messages/en.json";
import es from "../messages/es.json";
import { preferredLocale } from "../src/i18n/locales";

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") out.set(prefix, value);
  else if (value !== null && typeof value === "object") for (const [k, v] of Object.entries(value)) for (const [kk, vv] of flatten(v, prefix === "" ? k : `${prefix}.${k}`)) out.set(kk, vv);
  return out;
}

/** Argument and tag names of an ICU message (plural/select branches included), sorted. */
function argumentsOf(message: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: readonly unknown[]) => {
    for (const node of nodes as { type: number; value?: string; children?: unknown[]; options?: Record<string, { value: unknown[] }> }[]) {
      if (node.type !== 0 && typeof node.value === "string") names.add(node.value);
      if (node.children !== undefined) walk(node.children);
      for (const option of Object.values(node.options ?? {})) walk(option.value);
    }
  };
  walk(new IntlMessageFormat(message, "en").getAst());
  return [...names].sort();
}

describe("site catalogs", () => {
  const EN = flatten(en);
  const ES = flatten(es);

  it("have the same keys, no empty text and the same placeholders in English and Spanish", () => {
    expect([...ES.keys()].sort()).toEqual([...EN.keys()].sort());
    for (const [key, text] of EN) {
      expect(text.trim(), key).not.toBe("");
      expect((ES.get(key) ?? "").trim(), key).not.toBe("");
      expect(argumentsOf(ES.get(key) ?? ""), key).toEqual(argumentsOf(text));
    }
  });

  it("every plan and feature in content/pricing.ts has its words in both languages", () => {
    for (const plan of PLANS) {
      for (const field of ["name", "tagline", "cta"]) {
        expect(EN.has(`pricing.plans.${plan.id}.${field}`), `${plan.id}.${field}`).toBe(true);
        expect(ES.has(`pricing.plans.${plan.id}.${field}`), `${plan.id}.${field}`).toBe(true);
      }
      for (const f of plan.features) expect(EN.has(`pricing.features.${f.id}`) && ES.has(`pricing.features.${f.id}`), f.id).toBe(true);
    }
  });
});

describe("pricing (content/pricing.ts)", () => {
  it("annual billing: price × 10 / 12 rounded per month, and price × 10 a year", () => {
    expect([annualMonthly(29), annualTotal(29)]).toEqual([24, 290]);
    expect([annualMonthly(99), annualTotal(99)]).toEqual([83, 990]);
    expect(PLANS.map((p) => p.monthly)).toEqual([0, 29, 99, null]);
  });

  it("never promises as available what EXEGEZIS does not do yet", () => {
    const unavailable = new Set(PLANS.flatMap((p) => p.features.filter((f) => !f.available).map((f) => f.id)));
    // The cloud version, accounts and payments, daily monitoring, alerts, integrations, branded reports, the API and SSO.
    for (const id of ["dailyMonitoring", "brandedReports", "integrations", "apiAndChecks", "sso", "sitesAndUsers", "sharedTemplates", "customSitesAndUsers", "prioritySupport"]) {
      expect(unavailable.has(id), id).toBe(true);
    }
    // Paying needs accounts and payments: no paid plan can be bought yet.
    expect(PLANS.filter((p) => p.monthly !== 0).every((p) => !p.purchasable)).toBe(true);
    expect(PLANS.find((p) => p.id === "pro")?.highlighted).toBe(true);
  });
});

describe("language of /", () => {
  it("the first supported browser language, else English", () => {
    expect(preferredLocale(["es-MX", "en"])).toBe("es");
    expect(preferredLocale(["fr-FR", "en-GB"])).toBe("en");
    expect(preferredLocale(["fr-FR"])).toBe("en");
    expect(preferredLocale([])).toBe("en");
  });
});

describe("site colours: WCAG AA (4.5:1 for text)", () => {
  const css = readFileSync(join(__dirname, "../../../packages/design-tokens/tokens.css"), "utf8");
  const block = (selector: string): Record<string, string> => {
    const start = css.indexOf(`${selector} {`);
    const body = css.slice(start, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
  };
  const hex = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16)) as [number, number, number];
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  const lum = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a: [number, number, number], b: [number, number, number]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  const rgb = (t: Record<string, string>, name: string): [number, number, number] => {
    const v = t[name] as string;
    const mix = /color-mix\(in srgb, var\(--([\w-]+)\) (\d+)%, transparent\)/.exec(v);
    if (mix === null) return hex(v);
    const fg = rgb(t, mix[1] as string);
    const bg = rgb(t, "panel");
    const a = Number(mix[2]) / 100;
    return fg.map((c, i) => Math.round(c * a + (bg[i] as number) * (1 - a))) as [number, number, number];
  };
  const light = block(":root,\n.theme-light");
  const navy = block('html[data-theme="dark"],\n.theme-dark');

  it("the brief's colours are the tokens", () => {
    expect([navy["bg"], navy["heading"], navy["fg"], navy["accent"], navy["on-accent"], navy["panel-border"]]).toEqual(["#011b34", "#ffffff", "#d0db4e", "#cddc39", "#011b34", "#d0db4e"]);
    expect([light["bg"], light["panel"], light["panel-border"], light["panel-border-width"], light["accent-text"], light["accent"], light["on-accent"]]).toEqual(["#f2f5f6", "#ffffff", "#0066ff", "1.5px", "#0052cc", "#0066ff", "#ffffff"]);
  });

  it("every text pair the site uses reaches 4.5:1", () => {
    const pairs: [Record<string, string>, string, string][] = [
      // Navy bands: header, hero, report preview, closing call.
      [navy, "heading", "bg"],
      [navy, "fg", "bg"],
      [navy, "muted", "bg"],
      [navy, "text-soft", "bg"],
      [navy, "on-accent", "accent"],
      [navy, "on-accent", "accent-hover"],
      [navy, "heading", "panel"],
      [navy, "muted", "panel"],
      [navy, "heading", "sunken"],
      [navy, "muted", "sunken"],
      [navy, "heading", "field"],
      [navy, "muted", "field"],
      [navy, "ok", "ok-bg"],
      [navy, "warn", "warn-bg"],
      // Light body.
      [light, "heading", "bg"],
      [light, "heading", "panel"],
      [light, "muted", "panel"],
      [light, "muted", "bg"],
      [light, "muted", "sunken"],
      [light, "accent-text", "panel"],
      [light, "accent-text", "bg"],
      [light, "on-accent", "accent"],
      [light, "on-accent", "accent-hover"],
      [light, "ok", "ok-bg"],
      [light, "warn", "warn-bg"],
      [light, "q", "q-bg"],
      [light, "muted", "table-head"],
    ];
    const failing = pairs.map(([t, a, b]) => ({ pair: `${t === navy ? "navy" : "light"} ${a}/${b}`, r: ratio(rgb(t, a), rgb(t, b)) })).filter((p) => p.r < 4.5);
    expect(failing).toEqual([]);
  });
});
