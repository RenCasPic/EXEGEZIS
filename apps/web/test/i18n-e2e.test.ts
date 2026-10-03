import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discover } from "../src/lib/evidence/discover";
import { listJobs } from "../src/lib/jobs";
import { runsDir } from "../src/lib/workspace";
import { linkRuns, signedInUser, startTestApp, type TestApp } from "./support/app";

/*
 * The whole UI in both languages, in a real browser (docs/11-i18n.md): every
 * page renders only its language (words of the other one are forbidden, a
 * missing text shows as ⟦key⟧), <html lang> is right, the choice survives
 * navigation and reload, and no page scrolls sideways at 375 px. Content that
 * is never translated (the site's text, the user's, code, URLs) is marked
 * translate="no" and left out of the check.
 *
 * It runs its own app (support/app.ts) with its own build folder, so a
 * running `pnpm web` is not touched, signed in as a test user whose runs
 * folder shows the repository's runs/. I18N_SCREENSHOTS=1 also writes the
 * screenshots of docs/screenshots/i18n/.
 */

const WEB = join(import.meta.dirname, "..");
const REPO = join(WEB, "..", "..");
const LOCALES = ["en", "es"] as const;
type Locale = (typeof LOCALES)[number];

/** Words of one language that must never appear in the other one's UI (whole words, written as the UI writes them). */
const FORBIDDEN: Record<Locale, string[]> = {
  // English UI words on a Spanish page.
  es: ["Verified", "Not verified", "Investigations", "Investigation", "Settings", "Inspections", "Searches", "Projects", "Not implemented", "Evidence", "Overview", "Loading", "Reproduction", "Root cause", "Benchmark runs", "New search", "Inspect", "Pending", "Relevant", "Status", "Pages", "Results", "Report", "Attempts", "Planner output"],
  // Spanish UI words on an English page.
  en: ["Verificado", "No verificado", "Investigaciones", "Investigación", "Ajustes", "Inspecciones", "Búsquedas", "Proyectos", "No implementado", "Evidencia", "Resumen", "Cargando", "Reproducción", "Causa raíz", "Nueva búsqueda", "Inspeccionar", "Pendiente", "Relevante", "Estado", "Páginas", "Resultados", "Informe", "Intentos", "Buscar"],
};

let app: TestApp;
let browser: Browser | null = null;
let base = "";
/** The test user's session cookies (Supabase's), without the language the app saved for them. */
let session: Awaited<ReturnType<BrowserContext["storageState"]>> = { cookies: [], origins: [] };
const routes: string[] = [];
const details: { inspection: string | null; search: string | null } = { inspection: null, search: null };

async function contextFor(locale: Locale | null, options: { width?: number; acceptLanguage?: string } = {}): Promise<BrowserContext> {
  const context = await (browser as Browser).newContext({
    viewport: { width: options.width ?? 1280, height: 900 },
    locale: options.acceptLanguage ?? (locale === "es" ? "es-ES" : "en-US"),
    storageState: session,
  });
  if (locale !== null) await context.addCookies([{ name: "EXEGEZIS_LOCALE", value: locale, url: base }]);
  return context;
}

/** The page's UI text: visible text plus titles, labels and placeholders, without untranslatable content. */
async function uiText(page: Page): Promise<{ lang: string; text: string }> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll('[translate="no"], code, pre, kbd, script, style, noscript, template')) el.remove();
    const attributes = [...clone.querySelectorAll("[title], [aria-label], [placeholder], [alt]")].flatMap((el) =>
      ["title", "aria-label", "placeholder", "alt"].map((a) => el.getAttribute(a) ?? "").filter((v) => v !== ""),
    );
    return { lang: document.documentElement.lang, text: `${clone.textContent ?? ""}\n${attributes.join("\n")}\n${document.title}` };
  });
}

function problems(locale: Locale, text: string): string[] {
  const found: string[] = [];
  if (text.includes("⟦")) found.push(`missing text: ${/⟦[^⟧]*⟧/.exec(text)?.[0] ?? "⟦…⟧"}`);
  for (const word of FORBIDDEN[locale]) {
    // Case-sensitive UI words: technical codes (NOT_VERIFIED) and paths (/settings, x-report.json) are not UI words.
    const re = new RegExp(`(^|[^\\p{L}_/.-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}_/.-])`, "u");
    const m = re.exec(text);
    if (m !== null) found.push(`"${word}" in «${text.slice(Math.max(0, m.index - 40), m.index + word.length + 40).replace(/\s+/g, " ")}»`);
  }
  return found;
}

beforeAll(async () => {
  const index = await discover();
  const jobs = await listJobs();
  const firstOk = <T extends { id: string; report?: { status: string }; result?: { status: string } }>(items: T[]) =>
    items.find((i) => (i.report ?? i.result)?.status === "ok")?.id ?? null;
  details.inspection = firstOk(index.inspections);
  details.search = firstOk(index.searches);
  routes.push(
    "/",
    "/?modo=buscar",
    "/overview",
    "/investigations",
    "/investigations/new",
    "/inspections",
    "/searches",
    "/verification/reproductions",
    "/verification/root-causes",
    "/verification/fixes",
    "/planner",
    "/benchmarks",
    "/projects",
    "/settings",
    ...["environment", "models", "security", "permissions"].map((s) => `/settings?section=${s}`),
    "/settings/account",
    "/settings/access",
    "/settings/search",
    "/this-page-does-not-exist",
  );
  const investigation = index.investigations[0]?.id;
  if (investigation !== undefined) routes.push(`/investigations/${encodeURIComponent(investigation)}`);
  if (details.inspection !== null) routes.push(`/inspections/${details.inspection}`, `/inspections/${details.inspection}?vista=elementos`);
  if (details.search !== null) routes.push(`/searches/${details.search}`);
  const rootCause = index.rootCauses[0]?.id;
  if (rootCause !== undefined) routes.push(`/verification/root-causes/${encodeURIComponent(rootCause)}`);
  for (const kind of ["inspect", "search", "access", "ai-verify"]) {
    const job = jobs.find((j) => j.job.kind === kind);
    if (job !== undefined) routes.push(`/jobs/${job.job.id}`);
  }

  app = await startTestApp({ dist: ".next-e2e", log: "i18n-server.log" });
  base = app.base;
  browser = await chromium.launch();
  const user = await signedInUser(app, browser, { name: "Iris Test", email: `i18n-${Date.now()}@example.com` });
  session = { cookies: user.storageState.cookies.filter((c) => c.name.startsWith("sb-")), origins: [] };
  // The repository's runs (inspections, searches, investigations, web jobs) as the test user's own.
  linkRuns(app, user.id, runsDir());
}, 900_000);

afterAll(async () => {
  await browser?.close();
  await app?.stop();
}, 120_000);

describe("the UI in English and in Spanish", () => {
  for (const locale of LOCALES) {
    it(`every page is only in ${locale === "en" ? "English" : "Spanish"}, with the right <html lang>`, async () => {
      const context = await contextFor(locale);
      const page = await context.newPage();
      const failures: string[] = [];
      for (const route of routes) {
        await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 180_000 });
        const { lang, text } = await uiText(page);
        if (lang !== locale) failures.push(`${route}: <html lang="${lang}">`);
        for (const p of problems(locale, text)) failures.push(`${route}: ${p}`);
      }
      await context.close();
      expect(failures).toEqual([]);
    }, 900_000);
  }

  it("the default is the browser's language, else English", async () => {
    for (const [acceptLanguage, expected] of [
      ["es-MX", "es"],
      ["en-GB", "en"],
      ["fr-FR", "en"],
    ] as const) {
      const context = await contextFor(null, { acceptLanguage });
      const page = await context.newPage();
      await page.goto(`${base}/`, { waitUntil: "load" });
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(expected);
      await context.close();
    }
  }, 180_000);

  it("the choice in the top bar persists across navigation and reload", async () => {
    const context = await contextFor(null, { acceptLanguage: "en-US" });
    const page = await context.newPage();
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    await page.locator('[role="radiogroup"] [lang="es"]').click();
    await page.waitForFunction(() => document.documentElement.lang === "es", undefined, { timeout: 60_000 });
    await page.locator('a[href="/inspections"]').first().click();
    await page.waitForURL(`${base}/inspections`);
    await page.waitForFunction(() => document.querySelector("h1")?.textContent?.includes("Inspecciones") === true, undefined, { timeout: 60_000 });
    // Clicked below only once React has hydrated the page (in development the bundle arrives after "load").
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("es");
    expect(await page.locator("h1").first().textContent()).toContain("Inspecciones");
    await page.locator('[role="radiogroup"] [lang="en"]').click();
    await page.waitForFunction(() => document.documentElement.lang === "en", undefined, { timeout: 60_000 });
    await page.reload({ waitUntil: "load" });
    expect(await page.locator("h1").first().textContent()).toContain("Inspections");
    await context.close();
  }, 300_000);

  it("the language can be changed on a phone, and no page scrolls sideways at 375 px", async () => {
    const failures: string[] = [];
    for (const locale of LOCALES) {
      const context = await contextFor(locale, { width: 375 });
      const page = await context.newPage();
      for (const route of routes) {
        await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 180_000 });
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        if (width > 376) failures.push(`${locale} ${route}: ${width}px wide`);
      }
      await context.close();
    }
    expect(failures).toEqual([]);
    // The mobile switcher: one button that cycles the language.
    const context = await contextFor("en", { width: 375 });
    const page = await context.newPage();
    // Clicked only once React has hydrated the page (in development the bundle arrives after "load").
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    // On the home (docs/design/home-app-mobile.html) the language is in the menu.
    await page.locator('[aria-controls="home-menu"]').click();
    const toggle = page.locator("#home-menu [data-language-toggle]");
    await expect(toggle.isVisible()).resolves.toBe(true);
    await toggle.click();
    await page.waitForFunction(() => document.documentElement.lang === "es", undefined, { timeout: 60_000 });
    await context.close();
  }, 900_000);

  it.runIf(process.env["I18N_SCREENSHOTS"] === "1")("screenshots for docs/screenshots/i18n/", async () => {
    const out = join(REPO, "docs", "screenshots", "i18n");
    mkdirSync(out, { recursive: true });
    const shots: [string, string | null][] = [
      ["home", "/"],
      ["inspection", details.inspection === null ? null : `/inspections/${details.inspection}`],
      ["search", details.search === null ? null : `/searches/${details.search}`],
    ];
    for (const locale of LOCALES) {
      const context = await contextFor(locale, { width: 1366 });
      const page = await context.newPage();
      for (const [name, route] of shots) {
        if (route === null) continue;
        await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 180_000 });
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(out, `${name}-${locale}.png`) });
      }
      await context.close();
    }
  }, 600_000);
});
