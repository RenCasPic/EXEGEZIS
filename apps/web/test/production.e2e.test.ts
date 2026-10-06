import { createServer, type Server } from "node:http";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signedInUser, startTestApp, type TestApp } from "./support/app";

/*
 * The production build (`next build` + `next start`, NODE_ENV=production), as
 * it will run on a server: the public pages are static and cached, a visitor
 * signs up and reaches the app, and as a shared server it refuses to inspect
 * private addresses. The other end-to-end tests run `next dev`.
 */

let app: TestApp;
let browser: Browser | null = null;
let site: Server | null = null;
let local = "";

beforeAll(async () => {
  // A site on this machine: the production server must refuse to visit it.
  site = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><html lang=\"en\"><head><title>Local</title></head><body><main><h1>Local</h1></main></body></html>");
  });
  await new Promise<void>((resolve) => site?.listen(0, "127.0.0.1", resolve));
  const addr = site.address();
  local = `http://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}/`;
  app = await startTestApp({ dist: ".next-prod", log: "production-server.log", production: true });
  browser = await chromium.launch();
}, 900_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (site === null ? resolve() : site.close(() => resolve())));
  await app?.stop();
}, 120_000);

describe("the production build", () => {
  it("serves the public pages as static, cached HTML, and `/` without a session is the landing", async () => {
    for (const path of ["/producto", "/product", "/privacidad", "/terms"]) {
      const res = await fetch(`${app.base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control") ?? "", path).toMatch(/s-maxage=/);
      expect(res.headers.get("x-powered-by"), path).toBeNull();
    }
    const home = await fetch(`${app.base}/`, { headers: { "accept-language": "es-MX" } });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Solo lo que se puede demostrar");
    expect((await fetch(`${app.base}/inspections`, { redirect: "manual" })).status).toBe(307);
    expect(await (await fetch(`${app.base}/api/health`)).json()).toEqual({ ok: true });
  });

  it("a visitor signs up, confirms the email and reaches the app", async () => {
    const user = await signedInUser(app, browser as Browser, { name: "Prod", email: `prod-${Date.now()}@example.com` });
    const ctx = await (browser as Browser).newContext({ locale: "es-ES", storageState: { cookies: user.storageState.cookies.filter((c) => c.name.startsWith("sb-")), origins: [] } });
    const page = await ctx.newPage();
    await page.goto(`${app.base}/`, { waitUntil: "load" });
    await page.waitForSelector("#home-title");
    await ctx.close();
  }, 300_000);

  it("as a shared server, it refuses to inspect a private address", async () => {
    const user = await signedInUser(app, browser as Browser, { name: "Priv", email: `priv-${Date.now()}@example.com` });
    const ctx = await (browser as Browser).newContext({ locale: "es-ES", storageState: { cookies: user.storageState.cookies.filter((c) => c.name.startsWith("sb-")), origins: [] } });
    await ctx.addCookies([{ name: "EXEGEZIS_LOCALE", value: "es", url: app.base }]);
    const page = await ctx.newPage();
    await page.goto(`${app.base}/?url=${encodeURIComponent(local)}`, { waitUntil: "networkidle" });
    await page.locator('form button[type="submit"]').first().click();
    await page.locator('[role="alert"]').filter({ hasText: "direcciones públicas" }).first().waitFor({ state: "visible", timeout: 60_000 });
    await ctx.close();
  }, 300_000);
});
