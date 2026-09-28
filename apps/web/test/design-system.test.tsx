import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvidenceMeter, NotImplemented, ReplayTag, RunHistory, VerdictPill } from "../src/components/ui/status";
import { resolveTheme, THEME_BOOT_SCRIPT } from "../src/lib/theme";
import { verdictTone } from "../src/lib/verdicts";
import { setTestLocale } from "./setup";

beforeAll(() => setTestLocale("en"));
afterAll(() => setTestLocale("es"));

describe("VerdictPill", () => {
  it("maps every verdict to its family, never an unknown one to success", () => {
    expect(["VERIFIED", "VALIDATED"].map(verdictTone)).toEqual(["ok", "ok"]);
    expect(["CANDIDATE", "SUFFICIENT", "INTERMITTENT", "FLAKY"].map(verdictTone)).toEqual(["warn", "warn", "warn", "warn"]);
    expect(["INCONCLUSIVE", "INSUFFICIENT_EVIDENCE"].map(verdictTone)).toEqual(["q", "q"]);
    expect(["NOT_VERIFIED", "NOT VERIFIED", "REFUTED"].map(verdictTone)).toEqual(["off", "off", "off"]);
    expect(["FALSE VALIDATION", "INVALID_PLAN"].map(verdictTone)).toEqual(["bad", "bad"]);
    expect(verdictTone("SOMETHING NEW")).toBe("q");
  });

  it("always renders colour, icon and text (the label translated, the code in the tooltip)", () => {
    const html = renderToStaticMarkup(<VerdictPill verdict="NOT_VERIFIED" />);
    expect(html).toContain(">Not verified<");
    expect(html).toContain('title="Technical code: NOT_VERIFIED"');
    expect(html).toContain("<svg");
    expect(html).toContain("text-off");
  });

  it("NOT IMPLEMENTED is a dashed outline with no fill", () => {
    const html = renderToStaticMarkup(<NotImplemented />);
    expect(html).toContain("border-dashed");
    expect(html).toContain("bg-transparent");
  });

  it("REPLAY is a striped tag", () => {
    expect(renderToStaticMarkup(<ReplayTag />)).toContain("bg-stripes");
  });
});

describe("EvidenceMeter", () => {
  it("fills one segment per level reached and names the level", () => {
    const html = renderToStaticMarkup(<EvidenceMeter level="CANDIDATE" />);
    expect(html.match(/bg-warn/g)).toHaveLength(4);
    expect(html).toContain("Candidate");
    expect(html).toContain("4 of 5");
  });

  it("shows a dash, not NONE, when nothing was measured", () => {
    const html = renderToStaticMarkup(<EvidenceMeter level={null} />);
    expect(html).toContain("—");
    expect(html).not.toMatch(/bg-(ok|warn|q)"/);
  });
});

describe("RunHistory", () => {
  it("draws one dot per run: ok and q filled, off outlined, with an accessible count", () => {
    const html = renderToStaticMarkup(<RunHistory runs={["ok", "ok", "q", "off"]} />);
    expect(html.match(/bg-ok/g)).toHaveLength(2);
    expect(html.match(/bg-q/g)).toHaveLength(1);
    expect(html.match(/border-off/g)).toHaveLength(1);
    expect(html).toContain("2 proven, 1 inconclusive, 1 not proven");
    setTestLocale("es");
    expect(renderToStaticMarkup(<RunHistory runs={["ok", "ok", "q", "off"]} />)).toContain("2 demostradas, 1 inconclusa, 1 no demostrada");
    setTestLocale("en");
  });
});

describe("theme", () => {
  it("resolves System from the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("boots before paint and survives unavailable storage", () => {
    const set: Record<string, string> = {};
    const document = { documentElement: { setAttribute: (k: string, v: string) => (set[k] = v) } };
    const window = { matchMedia: () => ({ matches: true }) };
    const localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    runInNewContext(THEME_BOOT_SCRIPT, { document, window, localStorage });
    expect(set["data-theme"]).toBe("dark");
  });
});

describe("no loose colours in components", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : /\.(tsx|ts)$/.test(n) ? [p] : [];
    });
  }

  it("uses tokens only: no hex colours, no palette classes, no purple", () => {
    const offenders = files(join(__dirname, "../src"))
      .filter((f) => !f.endsWith("theme.ts"))
      .flatMap((f) => {
        const text = readFileSync(f, "utf8");
        const bad = [...text.matchAll(/#[0-9a-fA-F]{6}\b|\b(?:text|bg|border|fill)-(?:red|green|blue|yellow|purple|violet|indigo|gray|slate|zinc|emerald|amber|orange|sky)-\d{2,3}\b/g)].map((m) => m[0]);
        return bad.map((b) => `${f}: ${b}`);
      });
    expect(offenders).toEqual([]);
  });
});
