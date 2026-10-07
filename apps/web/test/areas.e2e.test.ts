import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAreasReport } from "./inspection-fixture";
import { signedInUser, startTestApp, type TestApp } from "./support/app";

/*
 * The inspection detail organized by area, in a real browser: the Frontend
 * and Backend cards, the subareas with their groups, the lab performance
 * table; in both languages and both themes, without sideways scroll at 375 px.
 */

let app: TestApp;
let browser: Browser | null = null;
let session: Awaited<ReturnType<typeof signedInUser>>["storageState"];
const report = buildAreasReport();

beforeAll(async () => {
  app = await startTestApp({ dist: ".next-e2e", log: "areas-server.log" });
  browser = await chromium.launch();
  const user = await signedInUser(app, browser, { name: "Area Test", email: `areas-${Date.now()}@example.com` });
  session = user.storageState;
  const dir = join(app.dataDir, "users", user.id, "runs", "inspections", report.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "inspection-report.json"), JSON.stringify(report, null, 2));
}, 900_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
}, 120_000);

const TEXT = {
  es: ["Frontend", "Backend (visto desde fuera)", "Diseño y accesibilidad", "Servicios externos", "Seguridad", "Configuración", "Accesos", "Rendimiento (laboratorio)", "no datos de visitantes reales", "Menú", "Sin Content-Security-Policy", "Las páginas que no existen responden 200"],
  en: ["Frontend", "Backend (seen from outside)", "Design and accessibility", "External services", "Security", "Configuration", "Access", "Performance (lab)", "not data from real visitors", "Menu", "No Content-Security-Policy", "Missing pages answer 200"],
} as const;

describe("the inspection detail by area", () => {
  it("shows Frontend and Backend, their subareas and the lab metrics, in both languages and themes, at 375 and 1280 px", async () => {
    const failures: string[] = [];
    for (const locale of ["es", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        for (const width of [375, 1280]) {
          const ctx = await (browser as Browser).newContext({ viewport: { width, height: 900 }, locale: locale === "en" ? "en-US" : "es-ES", colorScheme: theme, storageState: session });
          await ctx.addCookies([{ name: "EXEGEZIS_LOCALE", value: locale, url: app.base }]);
          await ctx.addInitScript((t) => {
            try {
              localStorage.setItem("exegezis-theme", t);
            } catch {
              // No storage: the OS theme (colorScheme) applies.
            }
          }, theme);
          const page = await ctx.newPage();
          await page.goto(`${app.base}/inspections/${report.id}`, { waitUntil: "load", timeout: 180_000 });
          // The groups open on click: open them all, so their badges are part of the text.
          for (const d of await page.locator("details").all()) await d.evaluate((el) => el.setAttribute("open", ""));
          const text = (await page.textContent("body")) ?? "";
          for (const want of TEXT[locale]) if (!text.includes(want)) failures.push(`${locale} ${theme} ${width}: missing «${want}»`);
          if (text.includes("⟦")) failures.push(`${locale} ${theme} ${width}: a missing translation`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (overflow > 0) failures.push(`${locale} ${theme} ${width}: ${overflow} px of sideways scroll`);
          const shots = process.env["AREAS_SCREENSHOTS"];
          if (shots !== undefined) await page.screenshot({ path: join(shots, `areas-${locale}-${theme}-${width}.png`), fullPage: true });
          const rows = await page.locator("#performance tbody tr").count();
          if (rows !== 4) failures.push(`${locale} ${theme} ${width}: ${rows} performance rows (2 pages × 2 devices)`);
          await ctx.close();
        }
      }
    }
    expect(failures).toEqual([]);
  }, 900_000);
});
