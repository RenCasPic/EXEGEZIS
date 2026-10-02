import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * The public site in a real browser: both languages without mixed words,
 * <html lang>, the language of `/`, the switcher, the Monthly / Annual prices,
 * «Coming soon» on what does not exist, 375 px without sideways scroll, the
 * keyboard (skip link, visible focus), the open FAQ and «Inspect for free» with the
 * local app running and stopped (a stand-in server plays the local app).
 *
 * It starts its own `next dev` on a free port with its own build folder.
 */

const SITE = join(import.meta.dirname, "..");
let server: ChildProcess | null = null;
let app: Server | null = null;
let appUrl = "";
let browser: Browser | null = null;
let base = "";

const FORBIDDEN = {
  // English words on the Spanish page.
  es: ["Pricing", "How it works", "Sign in", "Start for free", "Inspect for free", "Coming soon", "Monthly", "Annual", "Most chosen", "Frequently asked questions", "Available", "Verified", "Product"],
  // Spanish words on the English page.
  en: ["Precios", "Cómo funciona", "Iniciar sesión", "Empieza gratis", "Inspeccionar gratis", "Próximamente", "Mensual", "Anual", "Más elegido", "Preguntas frecuentes", "Disponible", "Verificado", "Producto"],
} as const;

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
    for (const el of clone.querySelectorAll("script, style, template")) el.remove();
    const attributes = [...clone.querySelectorAll("[aria-label], [placeholder], [title], [alt]")].flatMap((el) => ["aria-label", "placeholder", "title", "alt"].map((a) => el.getAttribute(a) ?? ""));
    return `${clone.textContent ?? ""}\n${attributes.join("\n")}\n${document.title}`;
  });
}

beforeAll(async () => {
  // A stand-in for the local app (apps/web): answers on its port while running.
  const appPort = await freePort();
  appUrl = `http://127.0.0.1:${appPort}`;
  app = createHttpServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><title>local app</title><p id="got">${req.url ?? ""}</p>`);
  });
  await new Promise<void>((resolve) => app?.listen(appPort, "127.0.0.1", resolve));

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(SITE, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: SITE,
    env: { ...process.env, EXEGEZIS_NEXT_DIST: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_EXEGEZIS_APP_URL: appUrl },
    stdio: "ignore",
    windowsHide: true,
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/en/`)).status < 500) break;
    } catch {
      // not up yet
    }
    if (i > 480) throw new Error("the site did not start");
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (app?.listening === true ? app.close(() => resolve()) : resolve()));
  if (server?.pid !== undefined) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill("SIGTERM");
  }
});

describe("the public site", () => {
  for (const locale of ["en", "es"] as const) {
    it(`/${locale}/ is entirely in ${locale === "en" ? "English" : "Spanish"}, with the right <html lang>, title and description`, async () => {
      const ctx = await context();
      const page = await ctx.newPage();
      await page.goto(`${base}/${locale}/`, { waitUntil: "load", timeout: 180_000 });
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

  it("/ opens the browser's language (else English), and the visitor's choice wins afterwards", async () => {
    for (const [locale, expected] of [
      ["es-MX", "es"],
      ["en-GB", "en"],
      ["fr-FR", "en"],
    ] as const) {
      const ctx = await context({ locale });
      const page = await ctx.newPage();
      await page.goto(`${base}/`);
      await page.waitForURL(`${base}/${expected}/`);
      await ctx.close();
    }
    const ctx = await context({ locale: "es-ES" });
    const page = await ctx.newPage();
    await page.goto(`${base}/es/`, { waitUntil: "networkidle" });
    await page.locator('header a[lang="en"]').click();
    await page.waitForURL(`${base}/en/`);
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    await page.goto(`${base}/`);
    await page.waitForURL(`${base}/en/`);
    await ctx.close();
  });

  it("Monthly / Annual: Pro $24 billed $290 a year, Team $83 billed $990 (and in Spanish), also with the arrow keys", async () => {
    for (const [locale, pro, proYear, team, teamYear] of [
      ["en", "$24", "Billed $290 a year", "$83", "Billed $990 a year"],
      ["es", "24 $", "Facturado 290 $ al año", "83 $", "Facturado 990 $ al año"],
    ] as const) {
      const ctx = await context();
      const page = await ctx.newPage();
      await page.goto(`${base}/${locale}/`, { waitUntil: "networkidle" });
      const plan = (id: string) => page.locator(`li[aria-labelledby="plan-${id}"]`);
      await expect(plan("pro").textContent()).resolves.toContain(locale === "en" ? "$29" : "29 $");
      // Keyboard: focus the selected option and move with the arrow.
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

  it("what does not exist yet says «Coming soon», never as available", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/es/`, { waitUntil: "networkidle" });
    const soon = await page.locator('#pricing li[data-available="false"]').allTextContents();
    expect(soon.length).toBeGreaterThanOrEqual(10);
    for (const text of soon) expect(text).toContain("Próximamente");
    for (const id of ["pro", "team", "enterprise"]) await expect(page.locator(`li[aria-labelledby="plan-${id}"]`).textContent()).resolves.toContain("Pagos: próximamente");
    await expect(page.locator('li[aria-labelledby="plan-free"]').textContent()).resolves.not.toContain("Próximamente");
    await ctx.close();
  });

  it("no sideways scroll at 375 px, and the menu opens on a phone", async () => {
    for (const locale of ["en", "es"]) {
      const ctx = await context({ width: 375 });
      const page = await ctx.newPage();
      await page.goto(`${base}/${locale}/`, { waitUntil: "networkidle" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), locale).toBe(0);
      await page.locator("header details summary").click();
      await expect(page.locator('header details nav a[href="#pricing"]').isVisible()).resolves.toBe(true);
      await ctx.close();
    }
  });

  it("works with the keyboard: skip link first, a visible focus on everything; every FAQ answer is shown", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/en/`, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    await expect(page.evaluate(() => document.activeElement?.getAttribute("href"))).resolves.toBe("#content");
    const invisible: string[] = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        // Next's development overlay is not part of the site (it does not exist in the static export).
        if (el === null || el === document.body || el.tagName === "NEXTJS-PORTAL") return null;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { what: `${el.tagName} ${el.textContent?.trim().slice(0, 30) ?? ""}`, outline: s.outlineStyle !== "none" && s.outlineWidth !== "0px", visible: r.width > 0 && r.height > 0 };
      });
      if (focus === null) continue;
      if (!focus.outline || !focus.visible) invisible.push(focus.what);
    }
    expect(invisible).toEqual([]);
    // The FAQ (as in the design) shows every answer: nothing to open.
    await expect(page.locator("#faq dt").count()).resolves.toBe(6);
    await expect(page.locator("#faq dd").first().isVisible()).resolves.toBe(true);
    await ctx.close();
  });

  it("«Inspect for free» opens the local app with the address filled in; if it is not running, it says how to start it", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/es/`, { waitUntil: "networkidle" });
    const hero = page.locator('section[aria-labelledby="hero-title"]');
    await hero.locator('input[type="url"]').fill("tu-web.com");
    await hero.locator('button[type="submit"]').click();
    await page.waitForURL(`${appUrl}/**`);
    expect(new URL(page.url()).searchParams.get("url")).toBe("https://tu-web.com/");

    await new Promise<void>((resolve) => app?.close(() => resolve()));
    await page.goto(`${base}/es/`, { waitUntil: "networkidle" });
    await hero.locator('input[type="url"]').fill("https://tu-web.com");
    await hero.locator('button[type="submit"]').click();
    const alert = hero.locator('[role="alert"]');
    await alert.waitFor({ timeout: 15_000 });
    const text = (await alert.textContent()) ?? "";
    expect(text).toContain("EXEGEZIS.cmd");
    expect(text).toContain("npm run dev");
    await hero.locator('input[type="url"]').fill("no es una url");
    await hero.locator('button[type="submit"]').click();
    await expect(hero.locator('[role="alert"]').textContent()).resolves.toContain("Escribe una dirección web");
    await ctx.close();
  });
});
