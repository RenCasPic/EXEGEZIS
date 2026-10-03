import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../packages/accounts/test/database";
import { startAuthStandin, type AuthStandin, type Mail } from "./support/auth-standin";

/*
 * Cloud mode end to end (docs/13-accounts.md), in a real browser against the
 * real app (`next dev`, EXEGEZIS_MODE=cloud) and a real Postgres with the
 * migrations and Row Level Security:
 * - sign-up → verification email → sign-in → inspection → sign-out;
 * - password recovery; OAuth (simulated provider) with the terms screen;
 * - two users: B never sees, opens or downloads anything of A's, in the UI or
 *   the API (pages, /api/artifacts, spec downloads, jobs, export);
 * - Free plan limits applied on the server; rate limits; `next` validation;
 * - sign out on every device; export (ZIP) and account deletion;
 * - the new screens in both languages and themes: WCAG AA (axe) and no
 *   sideways scroll at 375 px.
 *
 * Without Docker it uses PGlite and a Supabase Auth stand-in
 * (support/auth-standin.ts). With a real local Supabase (`supabase start`),
 * set EXEGEZIS_TEST_SUPABASE=1 with SUPABASE_URL, SUPABASE_ANON_KEY,
 * DATABASE_URL and MAILPIT_URL (docs/13-accounts.md): the same tests run
 * against it, except the simulated OAuth provider.
 */

const WEB = join(import.meta.dirname, "..");
const REAL = process.env["EXEGEZIS_TEST_SUPABASE"] === "1";
const PASSWORD = "una frase larga y segura";

let db: PGlite | null = null;
let socket: PGLiteSocketServer | null = null;
let standin: AuthStandin | null = null;
let sql: postgres.Sql;
let server: ChildProcess | null = null;
let site: Server | null = null;
let browser: Browser | null = null;
let base = "";
let target = "";
let dataDir = "";
let databaseUrl = "";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => resolve(typeof a === "object" && a !== null ? a.port : 0));
    });
  });
}

/** The latest email of `type` to `email`: from the stand-in, or from Mailpit with a real Supabase. */
async function lastMail(email: string, type: Mail["type"]): Promise<string> {
  if (!REAL) return (await (standin as AuthStandin).lastMail(email, type)).link;
  const mailpit = (process.env["MAILPIT_URL"] ?? "http://127.0.0.1:54324").replace(/\/+$/, "");
  for (let i = 0; i < 60; i++) {
    const list = (await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages: { ID: string }[] };
    const id = list.messages[0]?.ID;
    if (id !== undefined) {
      const message = (await (await fetch(`${mailpit}/api/v1/message/${id}`)).json()) as { Text: string };
      const link = /https?:\/\/\S+(auth\/v1\/verify|auth\/confirm)\S+/.exec(message.Text)?.[0];
      if (link !== undefined) return link.replace(/[)\]>.,]+$/, "");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${type} mail for ${email}`);
}

let nextIp = 1;

/** A browser of its own; each one comes from its own address (X-Forwarded-For), so the rate limits count per test. */
async function context(options: { width?: number; locale?: "en" | "es"; theme?: "light" | "dark"; ip?: string } = {}): Promise<BrowserContext> {
  const ip = options.ip ?? `198.51.100.${nextIp++}`;
  const ctx = await (browser as Browser).newContext({
    viewport: { width: options.width ?? 1280, height: 900 },
    locale: options.locale === "en" ? "en-US" : "es-ES",
    colorScheme: options.theme ?? "light",
    extraHTTPHeaders: { "x-forwarded-for": ip },
  });
  await ctx.addCookies([{ name: "EXEGEZIS_LOCALE", value: options.locale ?? "es", url: base }]);
  if (options.theme !== undefined) {
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("exegezis-theme", t);
      } catch {
        // No storage: the OS theme (colorScheme) applies.
      }
    }, options.theme);
  }
  return ctx;
}

async function signUp(page: Page, person: { name: string; email: string; password?: string }, path = "/signup"): Promise<void> {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.fill('input[name="name"]', person.name);
  await page.fill('input[name="email"]', person.email);
  await page.fill('input[name="password"]', person.password ?? PASSWORD);
  await page.check('input[name="terms"]');
  await page.click('form:has(input[name="terms"]) button[type="submit"]');
  await page.waitForURL(/\/verify-email/, { timeout: 60_000 });
}

async function verify(page: Page, email: string): Promise<void> {
  await page.goto(await lastMail(email, "signup"), { waitUntil: "load", timeout: 180_000 });
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/") && !u.pathname.startsWith("/login"), { timeout: 120_000 });
}

async function signIn(page: Page, email: string, password = PASSWORD, path = "/login"): Promise<void> {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.fill('form:has(input[name="password"]) input[name="email"]', email);
  await page.fill('form:has(input[name="password"]) input[name="password"]', password);
  await page.click('form:has(input[name="password"]) button[type="submit"]');
}

/** The text of the form's alert (Next's own route announcer is also role="alert", but empty and outside the forms). */
async function alertText(page: Page, form = "form"): Promise<string> {
  const alert = page.locator(`${form} [role="alert"]`).first();
  await alert.waitFor({ state: "visible", timeout: 60_000 });
  return ((await alert.textContent()) ?? "").trim();
}

/** Waits until the form's alert says `text` (it may still show the previous message for a moment). */
async function expectAlert(page: Page, text: string, form = "form"): Promise<void> {
  await page.locator(`${form} [role="alert"]`).filter({ hasText: text }).first().waitFor({ state: "visible", timeout: 60_000 });
}

async function userId(email: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`select id from auth.users where lower(email) = lower(${email})`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no user ${email}`);
  return id;
}

/** The inspection folders a user has on disk (cloud mode: data/users/<id>/runs/…). */
async function inspectionsOf(id: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 8) return;
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    if (names.includes("inspection-report.json")) found.push(dir);
    for (const n of names) if (!n.includes(".")) await walk(join(dir, n), depth + 1);
  }
  await walk(join(dataDir, "users", id, "runs"), 0);
  return found;
}

beforeAll(async () => {
  // The site to inspect: two plain pages on this machine.
  site = createHttpServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="en"><head><title>Fixture</title></head><body><main><h1>Fixture ${req.url ?? ""}</h1><a href="/about">About</a></main></body></html>`);
  });
  await new Promise<void>((resolve) => site?.listen(0, "127.0.0.1", resolve));
  const addr = site.address();
  target = `http://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}/`;

  dataDir = await mkdtemp(join(tmpdir(), "exegezis-cloud-"));
  let supabaseUrl: string;
  let anonKey: string;
  if (REAL) {
    supabaseUrl = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54321";
    anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
    databaseUrl = process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  } else {
    db = await testDatabase();
    const port = await freePort();
    // One Postgres session multiplexed: each connection's transaction runs alone.
    socket = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 8 });
    await socket.start();
    databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
    standin = await startAuthStandin(databaseUrl);
    supabaseUrl = standin.url;
    anonKey = standin.anonKey;
  }
  sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });

  // The app's output, to read when a test fails: apps/web/test/.tmp/cloud-server.log.
  mkdirSync(join(WEB, "test", ".tmp"), { recursive: true });
  const logFile = openSync(join(WEB, "test", ".tmp", "cloud-server.log"), "w");
  const appPort = await freePort();
  base = `http://127.0.0.1:${appPort}`;
  server = spawn(process.execPath, [join(WEB, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
    cwd: WEB,
    env: {
      ...process.env,
      EXEGEZIS_NEXT_DIST: ".next-cloud",
      NEXT_TELEMETRY_DISABLED: "1",
      EXEGEZIS_MODE: "cloud",
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: anonKey,
      DATABASE_URL: databaseUrl,
      EXEGEZIS_APP_URL: base,
      EXEGEZIS_SITE_URL: "http://127.0.0.1:4200",
      EXEGEZIS_DATA_DIR: dataDir,
      EXEGEZIS_OAUTH_PROVIDERS: REAL ? "" : "github",
      EXEGEZIS_ACCESS_KEY: randomBytes(32).toString("base64"),
      EXEGEZIS_DB_MAX_CONNECTIONS: "3",
      // The inspected site is on this machine: allowed only for this test (never in a production build).
      EXEGEZIS_ALLOW_PRIVATE_TARGETS: "1",
    },
    stdio: ["ignore", logFile, logFile],
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
}, 600_000);

afterAll(async () => {
  await browser?.close();
  if (server?.pid !== undefined) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => (site === null ? resolve() : site.close(() => resolve())));
  await sql?.end();
  await standin?.close();
  await socket?.stop();
  await db?.close();
  await rm(dataDir, { recursive: true, force: true });
}, 120_000);

const ana = { name: "Ana", email: `ana-${Date.now()}@example.com` };
const bea = { name: "Bea", email: `bea-${Date.now()}@example.com` };
let anaInspection = "";

describe("cloud mode: accounts", () => {
  it("without a session every page goes to /login (and back afterwards); the API answers 401", async () => {
    const res = await fetch(`${base}/inspections?x=1`, { redirect: "manual" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?next=%2Finspections%3Fx%3D1");
    expect((await fetch(`${base}/api/artifacts/01J0000000000000000000000X/report.json`)).status).toBe(401);
    expect((await fetch(`${base}/api/account/export`)).status).toBe(401);
  }, 300_000);

  it("sign-up → verification email → signed in, with the accepted terms recorded", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await signUp(page, ana);
    expect(await page.textContent("main")).toContain(ana.email);
    // Signing in before verifying: back to «check your email».
    await signIn(page, ana.email);
    await page.waitForURL(/\/verify-email/);
    await verify(page, ana.email);
    expect(new URL(page.url()).pathname).toBe("/");
    await page.waitForSelector("#home-title");
    const profile = await sql<{ terms_version: string | null; terms_accepted_at: Date | null; plan: string }[]>`select terms_version, terms_accepted_at, plan from public.profiles where id = ${await userId(ana.email)}`;
    expect(profile[0]?.terms_version).toMatch(/draft/);
    expect(profile[0]?.terms_accepted_at).not.toBeNull();
    expect(profile[0]?.plan).toBe("free");
    await ctx.close();
  }, 600_000);

  it("sign-up refuses a short password and a missing acceptance; an existing email gets the same answer as a new one", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/signup`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', "short@example.com");
    await page.fill('input[name="password"]', "corta");
    await page.check('input[name="terms"]');
    await page.click('form:has(input[name="terms"]) button[type="submit"]');
    await expectAlert(page, "10 caracteres");
    await page.fill('input[name="password"]', PASSWORD);
    await page.uncheck('input[name="terms"]');
    await page.click('form:has(input[name="terms"]) button[type="submit"]');
    await expectAlert(page, "acepta los términos");
    // Ana already has an account: the same «check your email» page, nobody learns it.
    await signUp(page, { name: "Otra", email: ana.email });
    await ctx.close();
  }, 300_000);

  it("a wrong password says only «wrong email or password»; `next` never leaves the app", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await signIn(page, ana.email, "no-es-esta-contraseña");
    await expectAlert(page, "Email o contraseña incorrectos.");
    await signIn(page, ana.email, PASSWORD, `/login?next=${encodeURIComponent("https://evil.example/x")}`);
    await page.waitForURL(`${base}/`);
    await page.goto(`${base}/login?next=%2Fsettings%2Faccount`);
    // Signed in: /login goes straight to `next`.
    await page.waitForURL(`${base}/settings/account`);
    await ctx.close();
  }, 300_000);

  it("Ana inspects a site; it is recorded as hers; she signs out", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await signIn(page, ana.email);
    await page.waitForURL(`${base}/`);
    await page.fill("#inspect-url", target);
    await page.click('button[aria-controls="inspect-advanced"]');
    await page.fill('input[name="maxPages"]', "2");
    await page.fill('input[name="runs"]', "1");
    await page.click('form:has(#inspect-url) button[type="submit"]');
    await page.waitForURL(/\/jobs\//, { timeout: 120_000 }).catch(async (error: unknown) => {
      throw new Error(`no job started: ${await page.locator('form:has(#inspect-url) [role="alert"]').first().textContent({ timeout: 1000 }).catch(() => "(no message)")}`, { cause: error });
    });
    const id = await userId(ana.email);
    for (let i = 0; (await inspectionsOf(id)).length === 0 || !existsSync(join((await inspectionsOf(id))[0] ?? "", "inspection-report.json")); i++) {
      if (i > 360) throw new Error("the inspection did not finish");
      await new Promise((r) => setTimeout(r, 1000));
    }
    anaInspection = ((await inspectionsOf(id))[0] ?? "").split(/[\\/]/).at(-1) ?? "";
    const runs = await sql<{ kind: string; site: string; pages_requested: number }[]>`select kind, site, pages_requested from public.runs where user_id = ${id}`;
    expect(runs).toEqual([{ kind: "inspection", site: "127.0.0.1", pages_requested: 2 }]);
    await page.goto(`${base}/inspections/${anaInspection}`, { waitUntil: "load" });
    expect(await page.locator("h1").first().textContent()).toBeTruthy();
    // Sign out from the user menu.
    await page.click("[data-user-menu]");
    await page.click("[data-sign-out]");
    await page.waitForURL(/\/login\?notice=signedOut/);
    await page.goto(`${base}/inspections`);
    await page.waitForURL(/\/login\?next=/);
    await ctx.close();
  }, 900_000);

  it("Bea never sees, opens or downloads anything of Ana's (pages, API, artifacts, specs, jobs, export)", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await signUp(page, bea);
    await verify(page, bea.email);
    await page.goto(`${base}/inspections`, { waitUntil: "load" });
    expect(await page.textContent("main")).not.toContain("127.0.0.1");
    for (const path of [`/inspections/${anaInspection}`, `/api/artifacts/${anaInspection}/inspection-report.json`, `/api/artifacts/${anaInspection}/specs/x.spec.ts?download=1`]) {
      const res = await page.request.get(`${base}${path}`);
      expect(res.status(), path).toBe(404);
    }
    const anaJobs = await readdir(join(dataDir, "users", await userId(ana.email), "runs", "web", "jobs"));
    for (const job of anaJobs) expect((await page.request.get(`${base}/jobs/${job}`)).status(), job).toBe(404);
    const zip = await page.request.get(`${base}/api/account/export`);
    expect(zip.status()).toBe(200);
    const body = (await zip.body()).toString("latin1");
    expect(body).toContain("account.json");
    expect(body).not.toContain(anaInspection);
    await ctx.close();
  }, 600_000);

  it("Free plan limits are applied on the server, with «See plans»", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await signIn(page, ana.email);
    await page.waitForURL(`${base}/`);
    // Another site: Free covers one.
    await page.fill("#inspect-url", target.replace("127.0.0.1", "localhost"));
    await page.click('form:has(#inspect-url) button[type="submit"]');
    await expectAlert(page, "1 sitio", "form:has(#inspect-url)");
    await expect(page.locator("[data-see-plans]").getAttribute("href")).resolves.toContain("#pricing");
    // More pages than Free allows.
    await page.fill("#inspect-url", target);
    await page.click('button[aria-controls="inspect-advanced"]');
    await page.fill('input[name="maxPages"]', "21");
    await page.click('form:has(#inspect-url) button[type="submit"]');
    await expectAlert(page, "20 páginas", "form:has(#inspect-url)");
    // Five inspections this month.
    const id = await userId(ana.email);
    for (let i = 0; i < 4; i++) await sql`insert into public.runs (id, user_id, kind, target_url, site, pages_requested) values (${`limit-${i}`}, ${id}, 'inspection', ${target}, '127.0.0.1', 1)`;
    await page.fill('input[name="maxPages"]', "2");
    await page.click('form:has(#inspect-url) button[type="submit"]');
    await expectAlert(page, "5 inspecciones al mes", "form:has(#inspect-url)");
    await ctx.close();
  }, 300_000);

  it("password recovery: the email's link, a new password, and only the new one works", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/forgot-password`, { waitUntil: "networkidle" });
    await page.fill('input[name="email"]', bea.email);
    await page.click('form:has(input[name="email"]) button[type="submit"]');
    await page.waitForURL(/forgot-password\?sent=1/);
    await page.goto(await lastMail(bea.email, "recovery"), { waitUntil: "load" });
    await page.waitForURL(/\/reset-password/);
    await page.fill('input[name="password"]', "otra frase larga 2026");
    await page.fill('input[name="confirm"]', "otra frase larga 2026");
    await page.click('form:has(input[name="confirm"]) button[type="submit"]');
    await page.waitForURL(/\/\?notice=password/);
    await page.click("[data-user-menu]");
    await page.click("[data-sign-out]");
    await page.waitForURL(/\/login/);
    await signIn(page, bea.email, PASSWORD);
    await expectAlert(page, "Email o contraseña incorrectos.");
    await signIn(page, bea.email, "otra frase larga 2026");
    await page.waitForURL(`${base}/`);
    await ctx.close();
  }, 300_000);

  it.skipIf(REAL)("OAuth (simulated GitHub): a new account accepts the terms first, then enters", async () => {
    (standin as AuthStandin).oauthAs({ email: `octo-${Date.now()}@example.com`, name: "Octo Cat", provider: "github" });
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.click('button[data-provider="github"]');
    await page.waitForURL(/\/welcome/, { timeout: 120_000 });
    expect(await page.textContent("h1")).toContain("Octo Cat");
    await page.check('input[name="terms"]');
    await page.click('form:has(input[name="terms"]) button[type="submit"]');
    await page.waitForURL(`${base}/`, { timeout: 120_000 });
    await ctx.close();
  }, 300_000);

  it("too many sign-in attempts are refused for a while", async () => {
    const email = `nadie-${Date.now()}@example.com`;
    let last = "";
    for (let i = 0; i < 11; i++) {
      const ctx = await context({ ip: "203.0.113.7" });
      const page = await ctx.newPage();
      await signIn(page, email, "x");
      last = await alertText(page);
      await ctx.close();
    }
    expect(last).toContain("Demasiados intentos");
  }, 600_000);

  it("«Sign out on every device» ends the other sessions too", async () => {
    const one = await context();
    const two = await context();
    const p1 = await one.newPage();
    const p2 = await two.newPage();
    await signIn(p1, ana.email);
    await p1.waitForURL(`${base}/`);
    await signIn(p2, ana.email);
    await p2.waitForURL(`${base}/`);
    await p1.goto(`${base}/settings/account#security`, { waitUntil: "networkidle" });
    await p1.click("[data-sign-out-everywhere]");
    await p1.waitForURL(/notice=signedOutEverywhere/);
    await p2.goto(`${base}/inspections`);
    await p2.waitForURL(/\/login\?next=/);
    await one.close();
    await two.close();
  }, 300_000);

  it("/api/session tells the landing (its origin only) who is signed in", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await signIn(page, bea.email, "otra frase larga 2026");
    await page.waitForURL(`${base}/`);
    const own = await page.request.get(`${base}/api/session`, { headers: { origin: "http://127.0.0.1:4200" } });
    expect(await own.json()).toMatchObject({ mode: "cloud", signedIn: true, name: "Bea" });
    expect(own.headers()["access-control-allow-origin"]).toBe("http://127.0.0.1:4200");
    expect(own.headers()["access-control-allow-credentials"]).toBe("true");
    const other = await page.request.get(`${base}/api/session`, { headers: { origin: "https://evil.example" } });
    expect(other.headers()["access-control-allow-origin"]).toBeUndefined();
    await ctx.close();
  }, 300_000);

  it("the account screens: both languages and themes, WCAG AA (axe), no sideways scroll at 375 px", async () => {
    const failures: string[] = [];
    for (const locale of ["es", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        for (const width of [1280, 375]) {
          const ctx = await context({ locale, theme, width });
          const page = await ctx.newPage();
          for (const path of ["/login", "/signup?plan=pro", "/forgot-password", "/verify-email?email=x%40example.com"]) {
            await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 180_000 });
            if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) failures.push(`${locale} ${theme} ${width} ${path}: sideways scroll`);
            if ((await page.textContent("body"))?.includes("⟦") === true) failures.push(`${locale} ${path}: missing text`);
            if ((await page.evaluate(() => document.documentElement.lang)) !== locale) failures.push(`${locale} ${path}: <html lang>`);
            const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
            for (const v of axe.violations) failures.push(`${locale} ${theme} ${width} ${path}: ${v.id} (${v.nodes.length})`);
          }
          await ctx.close();
        }
      }
    }
    // The signed-in screens (reset password, account settings) as Bea.
    for (const theme of ["light", "dark"] as const) {
      for (const width of [1280, 375]) {
        const ctx = await context({ theme, width });
        const page = await ctx.newPage();
        await signIn(page, bea.email, "otra frase larga 2026");
        await page.waitForURL(`${base}/`);
        for (const path of ["/settings/account", "/reset-password"]) {
          await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 180_000 });
          if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) failures.push(`${theme} ${width} ${path}: sideways scroll`);
          const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          for (const v of axe.violations) failures.push(`${theme} ${width} ${path}: ${v.id} (${v.nodes.length})`);
        }
        await ctx.close();
      }
    }
    expect(failures).toEqual([]);
  }, 1_200_000);

  it("export gives a ZIP with the account and the artifacts; deletion removes everything and the account no longer works", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await signIn(page, ana.email);
    await page.waitForURL(`${base}/`);
    const zip = (await (await page.request.get(`${base}/api/account/export`)).body()).toString("latin1");
    expect(zip).toContain("account.json");
    expect(zip).toContain("inspection-report.json");
    const id = await userId(ana.email);
    await page.goto(`${base}/settings/account#data`, { waitUntil: "networkidle" });
    await page.fill("[data-delete-confirm]", "otra@example.com");
    await page.click('form:has([data-delete-confirm]) button[type="submit"]');
    await expectAlert(page, "no coincide", "form:has([data-delete-confirm])");
    await page.fill("[data-delete-confirm]", ana.email);
    await page.click('form:has([data-delete-confirm]) button[type="submit"]');
    await page.waitForURL(/\/login\?notice=deleted/, { timeout: 120_000 });
    expect(existsSync(join(dataDir, "users", id))).toBe(false);
    for (const table of ["profiles", "consents", "runs", "waitlist"]) {
      const rows = await sql.unsafe(`select 1 from public.${table} where ${table === "profiles" ? "id" : "user_id"} = $1`, [id]);
      expect(rows.length, table).toBe(0);
    }
    expect((await sql`select 1 from auth.users where id = ${id}`).length).toBe(0);
    await signIn(page, ana.email);
    await expectAlert(page, "Email o contraseña incorrectos.");
    await ctx.close();
  }, 300_000);
});
