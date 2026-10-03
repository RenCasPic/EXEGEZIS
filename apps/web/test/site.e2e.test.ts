import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * The public pages inside the app (src/site), in a real browser, in local
 * mode: /producto and /product each entirely in their language, <html lang>,
 * title and Open Graph; `/` is still the app's home; the switcher; Monthly /
 * Annual prices; «Coming soon»; the legal drafts; 375 px without sideways
 * scroll; the keyboard (skip link, visible focus); «Inspect for free» opens
 * the Inspect tab with the address filled in. The cloud behaviour of `/` (the
 * landing without a session) is in cloud.e2e.test.ts.
 *
 * It starts its own `next dev` of apps/web on a free port with its own build folder.
 */

const WEB = join(import.meta.dirname, "..");
let server: ChildProcess | null = null;
let browser: Browser | null = null;
let base = "";

const FORBIDDEN = {
  // English words on the Spanish page.
  es: ["Pricing", "How it works", "Sign in", "Start for free", "Inspect for free", "Coming soon", "Monthly", "Annual", "Most chosen", "Available", "Verified", "Product", "Open the app"],
  // Spanish words on the English page.
  en: ["Precios", "Cómo funciona", "Iniciar sesión", "Empieza gratis", "Inspeccionar gratis", "Próximamente", "Mensual", "Anual", "Más elegido", "Disponible", "Verificado", "Producto", "Abrir la app"],
} as const;
const LANDING = { es: "/producto", en: "/product" } as const;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => resolve(typeof a === "object" && a !== null ? a.port : 0));
    });
  });
}

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

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(WEB, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: WEB,
    env: { ...process.env, EXEGEZIS_NEXT_DIST: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1", EXEGEZIS_MODE: "local" },
    stdio: "ignore",
    windowsHide: true,
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).status < 500) break;
    } catch {
      // not up yet
    }
    if (i > 480) throw new Error("the app did not start");
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  if (server?.pid !== undefined) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill("SIGTERM");
  }
});

describe("the public pages (local mode)", () => {
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

  it("/ is still the app's home in local mode; the switcher goes to the same page in the other language and sets the app's language", async () => {
    const ctx = await context({ locale: "es-ES" });
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: "load", timeout: 180_000 });
    await page.waitForSelector("#home-title");
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

  it("«Inspect for free» opens the app's Inspect tab with the address filled in; a non-address is refused", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/producto`, { waitUntil: "networkidle" });
    const hero = page.locator('section[aria-labelledby="hero-title"]');
    await hero.locator('input[type="url"]').fill("no es una url");
    await hero.locator('button[type="submit"]').click();
    await expect(hero.locator('[role="alert"]').textContent()).resolves.toContain("Escribe una dirección web");
    await hero.locator('input[type="url"]').fill("tu-web.com");
    await hero.locator('button[type="submit"]').click();
    await page.waitForURL(/\/\?url=/, { timeout: 120_000 });
    expect(new URL(page.url()).searchParams.get("url")).toBe("https://tu-web.com/");
    await page.waitForSelector("#inspect-url");
    await expect(page.locator("#inspect-url").inputValue()).resolves.toBe("https://tu-web.com/");
    await ctx.close();
  });
});
