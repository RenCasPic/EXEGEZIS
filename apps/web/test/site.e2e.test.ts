import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signUp, startTestApp, verify, type TestApp } from "./support/app";

/*
 * The public pages inside the app (src/site), in a real browser:
 * /producto and /product each entirely in their language, <html lang>, title
 * and Open Graph; `/` without a session is the landing; the switcher;
 * Monthly / Annual prices; «Coming soon»; the legal drafts; 375 px without
 * sideways scroll; the keyboard (skip link, visible focus); «Inspect for
 * free» signs the visitor up and then opens the Inspect tab with the address
 * filled in.
 *
 * It starts its own app (support/app.ts) with its own build folder.
 */

let app: TestApp;
let browser: Browser | null = null;
let base = "";

const FORBIDDEN = {
  // English words on the Spanish page.
  es: ["Pricing", "How it works", "Sign in", "Start for free", "Inspect for free", "Coming soon", "Monthly", "Annual", "Most chosen", "Available", "Verified", "Product", "Open the app"],
  // Spanish words on the English page.
  en: ["Precios", "Cómo funciona", "Iniciar sesión", "Empieza gratis", "Inspeccionar gratis", "Próximamente", "Mensual", "Anual", "Más elegido", "Disponible", "Verificado", "Producto", "Abrir la app"],
} as const;
const LANDING = { es: "/producto", en: "/product" } as const;

async function context(options: { locale?: string; width?: number } = {}): Promise<BrowserContext> {
  return (browser as Browser).newContext({ viewport: { width: options.width ?? 1280, height: 900 }, locale: options.locale ?? "en-US" });
}

async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll("script, style, template, nextjs-portal")) el.remove();
    const attributes = [...clone.querySelectorAll("[aria-label], [placeholder], [title], [alt]")].flatMap((el) => ["aria-label", "placeholder", "title", "alt"].map((a) => el.getAttribute(a) ?? ""));
    return `${clone.textContent ?? ""}\n${attributes.join("\n")}\n${document.title}`;
  });
}

/**
 * Why a header does not fit at this size: sideways scroll, a control past the
 * edge or covering another, a text cut or wrapped onto a second line, or the
 * header taller than its one row. Empty: it fits.
 */
async function headerProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) problems.push(`sideways scroll (${root.scrollWidth - root.clientWidth} px)`);
    const header = document.querySelector("header");
    if (header === null) return ["no header"];
    if (header.getBoundingClientRect().height > 80) problems.push(`header ${Math.round(header.getBoundingClientRect().height)} px tall`);
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && el.closest("[hidden], details:not([open]) > :not(summary), .sr-only") === null;
    };
    const controls = [...header.querySelectorAll("a, button, summary, label, [role=radiogroup]")].filter(shown).filter((el) => el.parentElement?.closest("a, button, summary, label") == null);
    const name = (el: Element) => `${el.tagName.toLowerCase()} «${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 24)}»`;
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.right > root.clientWidth) problems.push(`${name(el)} past the edge`);
      const h = el as HTMLElement;
      if (h.scrollWidth > h.clientWidth + 1 && getComputedStyle(h).overflowX !== "visible") problems.push(`${name(el)} cut`);
      const line = parseFloat(getComputedStyle(h).lineHeight) || parseFloat(getComputedStyle(h).fontSize) * 1.5;
      // Each visible text on one line (the text alone: an icon beside it is not a second line).
      const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if ((n.textContent ?? "").trim() === "" || n.parentElement === null || !shown(n.parentElement) || n.parentElement.closest("select, option") !== null) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const rects = [...range.getClientRects()].filter((c) => c.width > 0);
        const tops = rects.map((c) => c.top);
        if (rects.length > 1 && Math.max(...tops) - Math.min(...tops) > line / 2) problems.push(`${name(el)} on ${rects.length} lines`);
      }
    }
    for (let i = 0; i < controls.length; i++) {
      for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i] as Element;
        const b = controls[j] as Element;
        if (a.contains(b) || b.contains(a)) continue;
        const r = a.getBoundingClientRect();
        const q = b.getBoundingClientRect();
        const x = Math.min(r.right, q.right) - Math.max(r.left, q.left);
        const y = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
        if (x > 1 && y > 1) problems.push(`${name(a)} covers ${name(b)}`);
      }
    }
    return [...new Set(problems)];
  });
}

/** The widths of a laptop and a desktop: the headers must fit at each one. */
const HEADER_WIDTHS = [1024, 1152, 1280, 1366, 1440] as const;

beforeAll(async () => {
  app = await startTestApp({ dist: ".next-e2e", log: "site-server.log" });
  base = app.base;
  browser = await chromium.launch();
}, 600_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
}, 120_000);

describe("the public pages", () => {
  for (const locale of ["en", "es"] as const) {
    it(`${LANDING[locale]} is entirely in ${locale === "en" ? "English" : "Spanish"}, with the right <html lang>, title and Open Graph`, async () => {
      const ctx = await context();
      const page = await ctx.newPage();
      await page.goto(`${base}${LANDING[locale]}`, { waitUntil: "load", timeout: 180_000 });
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(locale);
      const text = await visibleText(page);
      expect(text).not.toContain("⟦");
      const found = FORBIDDEN[locale].filter((w) => new RegExp(`(^|[^\\p{L}])${w}(?=$|[^\\p{L}])`, "u").test(text));
      expect(found).toEqual([]);
      expect(await page.title()).toBe(locale === "en" ? "EXEGEZIS — Only what can be proven" : "EXEGEZIS — Solo lo que se puede demostrar");
      expect(await page.locator('meta[property="og:locale"]').getAttribute("content")).toBe(locale === "en" ? "en_US" : "es_ES");
      await ctx.close();
    });
  }

  it("/ without a session is the landing in the visitor's language; the switcher goes to the same page in the other language and sets the app's language", async () => {
    const ctx = await context({ locale: "es-ES" });
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: "load", timeout: 180_000 });
    expect(new URL(page.url()).pathname).toBe("/");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("es");
    await page.waitForSelector("#hero-title");
    await page.goto(`${base}/producto`, { waitUntil: "networkidle" });
    await page.locator('header a[lang="en"]').click();
    await page.waitForURL(`${base}/product`);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    expect((await ctx.cookies()).find((c) => c.name === "EXEGEZIS_LOCALE")?.value).toBe("en");
    await page.goto(`${base}/privacidad`, { waitUntil: "networkidle" });
    await page.locator('header a[lang="en"]').click();
    await page.waitForURL(`${base}/privacy`);
    await ctx.close();
  });

  it("Monthly / Annual: Pro $24 billed $290 a year, Team $83 billed $990 (and in Spanish), also with the arrow keys", async () => {
    for (const [locale, pro, proYear, team, teamYear] of [
      ["en", "$24", "Billed $290 a year", "$83", "Billed $990 a year"],
      ["es", "24 $", "Facturado 290 $ al año", "83 $", "Facturado 990 $ al año"],
    ] as const) {
      const ctx = await context();
      const page = await ctx.newPage();
      await page.goto(`${base}${LANDING[locale]}`, { waitUntil: "networkidle" });
      const plan = (id: string) => page.locator(`li[aria-labelledby="plan-${id}"]`);
      await expect(plan("pro").textContent()).resolves.toContain(locale === "en" ? "$29" : "29 $");
      await page.locator('[role="radiogroup"] [data-billing="monthly"]').focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.locator('[data-billing="annual"]').getAttribute("aria-checked")).resolves.toBe("true");
      const proText = (await plan("pro").textContent()) ?? "";
      const teamText = (await plan("team").textContent()) ?? "";
      expect(proText).toContain(pro);
      expect(proText).toContain(proYear);
      expect(teamText).toContain(team);
      expect(teamText).toContain(teamYear);
      await ctx.close();
    }
  });

  it("what does not exist yet says «Coming soon», never as available; the legal pages are marked as drafts", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/producto`, { waitUntil: "networkidle" });
    const soon = await page.locator('#pricing li[data-available="false"]').allTextContents();
    expect(soon.length).toBeGreaterThanOrEqual(10);
    for (const text of soon) expect(text).toContain("Próximamente");
    for (const id of ["pro", "team", "enterprise"]) await expect(page.locator(`li[aria-labelledby="plan-${id}"]`).textContent()).resolves.toContain("Pagos: próximamente");
    await expect(page.locator('li[aria-labelledby="plan-free"]').textContent()).resolves.not.toContain("Próximamente");
    for (const [path, draft] of [
      ["/privacidad", "Borrador pendiente de revisión legal"],
      ["/terminos", "Borrador pendiente de revisión legal"],
      ["/privacy", "Draft pending legal review"],
      ["/terms", "Draft pending legal review"],
    ] as const) {
      await page.goto(`${base}${path}`, { waitUntil: "load" });
      await expect(page.locator("[data-legal-draft]").textContent()).resolves.toContain(draft);
    }
    await ctx.close();
  });

  it("no sideways scroll at 375 px, and the menu opens on a phone", async () => {
    for (const locale of ["en", "es"] as const) {
      const ctx = await context({ width: 375 });
      const page = await ctx.newPage();
      await page.goto(`${base}${LANDING[locale]}`, { waitUntil: "networkidle" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), locale).toBe(0);
      await page.locator("header details summary").click();
      await expect(page.locator(`header details nav a[href="${LANDING[locale]}#pricing"]`).isVisible()).resolves.toBe(true);
      await ctx.close();
    }
  });

  it("the headers fit at 1024, 1152, 1280, 1366 and 1440 px: both languages, both themes, with and without a session", async () => {
    const failures: string[] = [];
    const email = `header-${Date.now()}@example.com`;
    const setup = await context();
    const signer = await setup.newPage();
    await signUp(app, signer, { name: "Maximiliana Fernández de la Concepción", email });
    await verify(app, signer, email);
    const session = await setup.storageState();
    await setup.close();
    for (const signedIn of [false, true]) {
      for (const locale of ["es", "en"] as const) {
        for (const theme of ["light", "dark"] as const) {
          const ctx = await (browser as Browser).newContext({ viewport: { width: 1440, height: 900 }, locale: locale === "en" ? "en-US" : "es-ES", colorScheme: theme, ...(signedIn ? { storageState: session } : {}) });
          await ctx.addCookies([{ name: "EXEGEZIS_LOCALE", value: locale, url: base }]);
          await ctx.addInitScript((t) => {
            try {
              localStorage.setItem("exegezis-theme", t);
            } catch {
              // No storage: the OS theme (colorScheme) applies.
            }
          }, theme);
          const page = await ctx.newPage();
          for (const path of ["/", LANDING[locale]]) {
            await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 180_000 });
            for (const width of HEADER_WIDTHS) {
              await page.setViewportSize({ width, height: 900 });
              await page.waitForTimeout(50);
              for (const p of await headerProblems(page)) failures.push(`${signedIn ? "signed in" : "visitor"} ${locale} ${theme} ${width} ${path}: ${p}`);
            }
          }
          await ctx.close();
        }
      }
    }
    expect(failures).toEqual([]);
  }, 900_000);

  it("works with the keyboard: skip link first and a visible focus on everything; every FAQ answer is shown", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/product`, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    await expect(page.evaluate(() => document.activeElement?.getAttribute("href"))).resolves.toBe("#content");
    const invisible: string[] = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        // Next's development overlay is not part of the page (it does not exist in a production build).
        if (el === null || el === document.body || el.tagName === "NEXTJS-PORTAL") return null;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { what: `${el.tagName} ${el.textContent?.trim().slice(0, 30) ?? ""}`, outline: s.outlineStyle !== "none" && s.outlineWidth !== "0px", visible: r.width > 0 && r.height > 0 };
      });
      if (focus === null) continue;
      if (!focus.outline || !focus.visible) invisible.push(focus.what);
    }
    expect(invisible).toEqual([]);
    await expect(page.locator("#faq dt").count()).resolves.toBe(6);
    await expect(page.locator("#faq dd").first().isVisible()).resolves.toBe(true);
    await ctx.close();
  });

  it("«Inspect for free» signs up first, then opens the app's Inspect tab with the address filled in; a non-address is refused", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/producto`, { waitUntil: "networkidle" });
    const hero = page.locator('section[aria-labelledby="hero-title"]');
    await hero.locator('input[type="url"]').fill("no es una url");
    await hero.locator('button[type="submit"]').click();
    await expect(hero.locator('[role="alert"]').textContent()).resolves.toContain("Escribe una dirección web");
    await hero.locator('input[type="url"]').fill("tu-web.com");
    await hero.locator('button[type="submit"]').click();
    await page.waitForURL(/\/signup\?/, { timeout: 120_000 });
    const signup = new URL(page.url());
    expect(signup.searchParams.get("next")).toBe("/?url=https%3A%2F%2Ftu-web.com%2F");
    const email = `site-${Date.now()}@example.com`;
    await signUp(app, page, { name: "Sol", email }, `${signup.pathname}${signup.search}`);
    await verify(app, page, email);
    await page.waitForURL(/\/\?url=/, { timeout: 120_000 });
    expect(new URL(page.url()).searchParams.get("url")).toBe("https://tu-web.com/");
    await page.waitForSelector("#inspect-url");
    await expect(page.locator("#inspect-url").inputValue()).resolves.toBe("https://tu-web.com/");
    await ctx.close();
  });
});
