import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, openSync, readdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { Browser, BrowserContext, Page } from "playwright";
import postgres from "postgres";
import { ensureFreshCache } from "../../scripts/fresh-cache.mjs";
import { testDatabase } from "../../../../packages/accounts/test/database.ts";
import { startAuthStandin, type AuthStandin, type Mail } from "./auth-standin.ts";

/*
 * The real app (`next dev`) for the end-to-end tests, as it always runs: with
 * accounts. Without Docker it uses PGlite (the migrations and Row Level
 * Security) and a Supabase Auth stand-in (auth-standin.ts). With a real local
 * Supabase (`supabase start`), set EXEGEZIS_TEST_SUPABASE=1 with SUPABASE_URL,
 * SUPABASE_ANON_KEY, DATABASE_URL and MAILPIT_URL (docs/13-accounts.md).
 * Each test file has its own build folder, its own data folder and its own
 * database, so a running `pnpm web` is never touched.
 */

const WEB = join(import.meta.dirname, "..", "..");
export const REAL_SUPABASE = process.env["EXEGEZIS_TEST_SUPABASE"] === "1";
export const TEST_PASSWORD = "una frase larga y segura";

export interface TestApp {
  base: string;
  /** EXEGEZIS_DATA_DIR: each user's folders are in users/<id>/. */
  dataDir: string;
  databaseUrl: string;
  sql: postgres.Sql;
  /** The Supabase Auth stand-in; null with a real Supabase. */
  standin: AuthStandin | null;
  /** The latest email of `type` to `email`: its link. */
  lastMail(email: string, type: Mail["type"]): Promise<string>;
  userId(email: string): Promise<string>;
  stop(): Promise<void>;
}

export function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => resolve(typeof a === "object" && a !== null ? a.port : 0));
    });
  });
}

/** Starts the database, Supabase Auth (the stand-in, or a real one) and the app. Its output: apps/web/test/.tmp/<log>. */
export async function startTestApp(options: { dist: string; log: string; env?: Record<string, string> }): Promise<TestApp> {
  const dataDir = await mkdtemp(join(tmpdir(), "exegezis-test-"));
  let db: PGlite | null = null;
  let socket: PGLiteSocketServer | null = null;
  let standin: AuthStandin | null = null;
  let supabaseUrl: string;
  let anonKey: string;
  let databaseUrl: string;
  if (REAL_SUPABASE) {
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
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });

  mkdirSync(join(WEB, "test", ".tmp"), { recursive: true });
  const logFile = openSync(join(WEB, "test", ".tmp", options.log), "w");
  const appPort = await freePort();
  const base = `http://127.0.0.1:${appPort}`;
  // A build folder from before a change of the app's structure would serve stale routes.
  ensureFreshCache(options.dist);
  const server: ChildProcess = spawn(process.execPath, [join(WEB, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(appPort)], {
    cwd: WEB,
    env: {
      ...process.env,
      EXEGEZIS_NEXT_DIST: options.dist,
      NEXT_TELEMETRY_DISABLED: "1",
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: anonKey,
      DATABASE_URL: databaseUrl,
      EXEGEZIS_APP_URL: base,
      EXEGEZIS_DATA_DIR: dataDir,
      EXEGEZIS_OAUTH_PROVIDERS: REAL_SUPABASE ? "" : "github",
      EXEGEZIS_ACCESS_KEY: randomBytes(32).toString("base64"),
      EXEGEZIS_DB_MAX_CONNECTIONS: "3",
      ...options.env,
    },
    stdio: ["ignore", logFile, logFile],
    windowsHide: true,
  });

  const stop = async () => {
    if (server.pid !== undefined) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      else server.kill("SIGTERM");
    }
    await sql.end();
    await standin?.close();
    await socket?.stop();
    await db?.close();
    unlinkRuns(dataDir);
    await rm(dataDir, { recursive: true, force: true });
  };

  try {
    for (let i = 0; ; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).status < 500) break;
      } catch {
        // not up yet
      }
      if (i > 480) throw new Error(`the app did not start (see apps/web/test/.tmp/${options.log})`);
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (error) {
    await stop();
    throw error;
  }

  const lastMail = async (email: string, type: Mail["type"]): Promise<string> => {
    if (standin !== null) return (await standin.lastMail(email, type)).link;
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
  };

  const userId = async (email: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`select id from auth.users where lower(email) = lower(${email})`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no user ${email}`);
    return id;
  };

  return { base, dataDir, databaseUrl, sql, standin, lastMail, userId, stop };
}

/** Fills in and sends the sign-up form; ends on «check your email». */
export async function signUp(app: TestApp, page: Page, person: { name: string; email: string; password?: string }, path = "/signup"): Promise<void> {
  await page.goto(`${app.base}${path}`, { waitUntil: "networkidle", timeout: 180_000 });
  await page.fill('input[name="name"]', person.name);
  await page.fill('input[name="email"]', person.email);
  await page.fill('input[name="password"]', person.password ?? TEST_PASSWORD);
  await page.check('input[name="terms"]');
  await page.click('form:has(input[name="terms"]) button[type="submit"]');
  await page.waitForURL(/\/verify-email/, { timeout: 60_000 });
}

/** Opens the verification email's link: signed in. */
export async function verify(app: TestApp, page: Page, email: string): Promise<void> {
  await page.goto(await app.lastMail(email, "signup"), { waitUntil: "load", timeout: 180_000 });
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/") && !u.pathname.startsWith("/login"), { timeout: 120_000 });
}

/** A new account, signed up and verified in a browser of its own: its id and its session, for `browser.newContext({ storageState })`. */
export async function signedInUser(app: TestApp, browser: Browser, person: { name: string; email: string }): Promise<{ id: string; storageState: Awaited<ReturnType<BrowserContext["storageState"]>> }> {
  const ctx = await browser.newContext({ locale: "en-US" });
  try {
    const page = await ctx.newPage();
    await signUp(app, page, person);
    await verify(app, page, person.email);
    return { id: await app.userId(person.email), storageState: await ctx.storageState() };
  } finally {
    await ctx.close();
  }
}

/**
 * Shows `runs` (the repository's runs/, say) as the user's own runs folder,
 * through a link: nothing is copied, and the app only reads it.
 */
export function linkRuns(app: TestApp, userId: string, runs: string): void {
  const own = join(app.dataDir, "users", userId, "runs");
  mkdirSync(dirname(own), { recursive: true });
  if (existsSync(own)) {
    if (lstatSync(own).isSymbolicLink()) unlinkSync(own);
    else rmSync(own, { recursive: true, force: true });
  }
  symlinkSync(runs, own, process.platform === "win32" ? "junction" : "dir");
}

/** Removes the links of linkRuns (only the links: what they point to stays untouched) before the data folder is deleted. */
function unlinkRuns(dataDir: string): void {
  const users = join(dataDir, "users");
  if (!existsSync(users)) return;
  for (const id of readdirSync(users)) {
    const own = join(users, id, "runs");
    try {
      if (lstatSync(own).isSymbolicLink()) unlinkSync(own);
    } catch {
      // no runs folder
    }
  }
}
