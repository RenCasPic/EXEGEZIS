import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { AREAS, CATALOGS } from "../src/i18n/messages";
import { resolveLocale } from "../src/i18n/locales";

/*
 * docs/11-i18n.md: both catalogs have exactly the same keys, no empty text and
 * the same {placeholders}; no visible text is written directly in the
 * components (it must come from the catalogs).
 */

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) for (const [kk, vv] of flatten(v, prefix === "" ? k : `${prefix}.${k}`)) out.set(kk, vv);
  return out;
}

/** Argument names used in an ICU message ({name}, {count, plural, …}). */
function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{\s*([A-Za-z_][\w]*)\s*(?:[,}])/g)].map((m) => m[1] ?? ""))].sort();
}

describe("message catalogs", () => {
  const en = flatten(CATALOGS.en);
  const es = flatten(CATALOGS.es);

  it("register one file per area in both languages", () => {
    for (const locale of ["en", "es"]) {
      const files = readdirSync(join(__dirname, "..", "messages", locale)).map((f) => f.replace(/\.json$/, "")).sort();
      expect(files).toEqual([...AREAS].sort());
    }
  });

  it("have exactly the same keys in English and Spanish", () => {
    expect([...en.keys()].filter((k) => !es.has(k))).toEqual([]);
    expect([...es.keys()].filter((k) => !en.has(k))).toEqual([]);
  });

  it("have no empty translation", () => {
    expect([...en].filter(([, v]) => v.trim() === "").map(([k]) => `en:${k}`)).toEqual([]);
    expect([...es].filter(([, v]) => v.trim() === "").map(([k]) => `es:${k}`)).toEqual([]);
  });

  it("use the same placeholders in both languages", () => {
    const mismatched = [...en].filter(([k, v]) => es.has(k) && placeholders(v).join() !== placeholders(es.get(k) ?? "").join()).map(([k]) => k);
    expect(mismatched).toEqual([]);
  });
});

describe("language choice", () => {
  it("cookie first, then the browser's languages in order, else English", () => {
    expect(resolveLocale("es", "en-US,en;q=0.9")).toBe("es");
    expect(resolveLocale(undefined, "es-MX,es;q=0.9,en;q=0.8")).toBe("es");
    expect(resolveLocale(undefined, "fr-FR,fr;q=0.9,es;q=0.5,en;q=0.7")).toBe("en");
    expect(resolveLocale(undefined, "de-DE")).toBe("en");
    expect(resolveLocale("xx", null)).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// No visible text written in the components
// ---------------------------------------------------------------------------

const SRC = join(__dirname, "..", "src");
/** Attributes whose value a person reads or hears. */
const TEXT_ATTRIBUTES = new Set(["title", "aria-label", "placeholder", "alt", "label", "description", "subtitle", "textLabel", "hint", "message"]);
/** Text that is the same in every language: symbols, numbers, units, file and product names. */
const SAME_IN_EVERY_LANGUAGE = /^(?:[\s\d\p{P}\p{S}]*|EXEGEZIS|N\/I|Esc|ms|px|CSV|PDF|JSON|USD|HTTP|WAF|URL|OK|Playwright|axe-core|robots\.txt|[\w.-]+\.(?:json|log|zip|ts|png|html))$/u;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));
}

function hardcoded(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const where = (n: ts.Node) => `${file.slice(SRC.length + 1)}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const visible = (text: string) => /\p{L}/u.test(text) && !SAME_IN_EVERY_LANGUAGE.test(text.trim());
  /** Content marked translate="no" (site text, user text, code, URLs) is never translated. */
  const untranslatable = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
      if (ts.isJsxElement(p) && p.openingElement.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === "translate" && a.initializer !== undefined && a.initializer.getText() === '"no"')) return true;
    }
    return false;
  };
  const literalText = (e: ts.Expression): string | null => (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : ts.isTemplateExpression(e) ? [e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(" ") : null);
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n) && visible(n.text) && !untranslatable(n)) found.push(`${where(n)} «${n.text.trim().slice(0, 60)}»`);
    if (ts.isJsxExpression(n) && n.expression !== undefined && ts.isJsxElement(n.parent) && !untranslatable(n)) {
      const text = literalText(n.expression);
      if (text !== null && visible(text)) found.push(`${where(n)} «${text.slice(0, 60)}»`);
    }
    if (ts.isJsxAttribute(n) && TEXT_ATTRIBUTES.has(n.name.getText()) && n.initializer !== undefined) {
      const init = n.initializer;
      const text = ts.isStringLiteral(init) ? init.text : ts.isJsxExpression(init) && init.expression !== undefined ? literalText(init.expression) : null;
      if (text !== null && visible(text)) found.push(`${where(n)} ${n.name.getText()}=«${text.slice(0, 60)}»`);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return found;
}

describe("components", () => {
  it("write no visible text directly: everything comes from the catalogs", () => {
    const all = files(SRC).flatMap(hardcoded);
    // I18N_REPORT=1: print what is left, by file.
    if (process.env["I18N_REPORT"] === "1") process.stdout.write(`${all.join("\n")}\n${all.length} texts\n`);
    expect(all).toEqual([]);
  });
});
