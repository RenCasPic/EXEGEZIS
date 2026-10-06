import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AccessStore, DpapiProtector, type KeyProtector } from "@exegezis/access";
import type { AdapterAccess } from "@exegezis/adapter-browser";
import type { InspectionReport } from "@exegezis/core";
import type { Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureAccess, inspectSite, type InspectOptions } from "../src/index.js";

/**
 * Access end to end against inspect-lab /access/* in real Chromium
 * (docs/09-access.md §6). The "visible window" runs headless and a script
 * plays the person; everything else is the real flow: classification,
 * capture, encrypted storage, inspection with the saved access.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LAB = join(REPO, "examples/inspect-lab");
const WORK = join(REPO, "packages/inspect/test/.tmp-access");
const VERSION = "0.1.0";

let lab: ChildProcess;
let base: string;
let store: AccessStore;
const fakeProtector: KeyProtector = { name: "test", protect: async (b) => Buffer.from(b.map((x) => x ^ 0x5a)), unprotect: async (b) => Buffer.from(b.map((x) => x ^ 0x5a)) };

async function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => done(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}
const labGet = async <T>(path: string): Promise<T> => (await (await fetch(`${base}${path}`)).json()) as T;
interface Stats {
  logout: number;
  destructive: number;
  tokenToThirdParty: number;
  tokenToApp: number;
  fingerprints: { header: string; navigatorUserAgent: string; webdriver: string }[];
}

let counter = 0;
async function inspect(path: string, options: Partial<InspectOptions> = {}): Promise<{ report: InspectionReport; dir: string }> {
  counter += 1;
  const dir = join(WORK, `inspection-${counter}`);
  const report = await inspectSite({ url: `${base}${path}`, dir, id: `access-${counter}`, exegezisVersion: VERSION, runs: 1, maxPages: 1, delayMs: 0, devices: ["desktop"], ...options });
  return { report, dir };
}
const kind = (r: InspectionReport) => r.pages.find((p) => p.depth === 0 && p.run === 1)?.block?.kind ?? null;

/** Every file under `dir`, as text (binary files included as latin1). */
function allText(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(readFileSync(p).toString("latin1"));
    }
  };
  walk(dir);
  return out.join("\n");
}

/** The person signs in (the script types; in real use, the person does). */
const signIn = (user: string, password: string) => async (page: Page) => {
  await page.getByLabel("User").fill(user);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/access\/app\//);
};

async function saved(path: string): Promise<AdapterAccess> {
  const origin = new URL(`${base}${path}`).origin;
  const secrets = (await store.get(origin)) ?? {};
  return {
    origin,
    ...(secrets.storageState === undefined ? {} : { storageState: secrets.storageState }),
    ...(secrets.httpCredentials === undefined ? {} : { httpCredentials: secrets.httpCredentials }),
    ...(secrets.wafToken === undefined ? {} : { wafToken: secrets.wafToken }),
  };
}

beforeAll(async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  store = new AccessStore(join(WORK, "access-store"), platform() === "win32" ? new DpapiProtector() : fakeProtector);
  const port = await freePort();
  base = `http://127.0.0.1:${port}/`;
  lab = spawn(process.execPath, ["src/server.ts"], { cwd: LAB, env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      if ((await fetch(`${base}__lab/health`)).ok) break;
    } catch {
      // not yet
    }
    if (Date.now() > deadline) throw new Error("inspect-lab did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
});

afterAll(() => {
  lab.kill();
  rmSync(WORK, { recursive: true, force: true });
});

describe("LOGIN_WALL → sign in in the window → inspect with the session", () => {
  let session: AdapterAccess;

  it("is LOGIN_WALL without a session, and a block never produces findings", async () => {
    const { report } = await inspect("access/app/");
    expect(report.status).toBe("BLOCKED");
    expect(kind(report)).toBe("LOGIN_WALL");
    expect(report.findings).toEqual([]);
  });

  it("the person signs in; the state is saved only once the block is gone, encrypted", async () => {
    const result = await captureAccess({ url: `${base}access/app/`, exegezisVersion: VERSION, person: signIn("rene", "lab-password"), headless: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await store.put(`${base}access/app/`, { storageState: result.storageState });
    session = await saved("access/app/");
    expect(session.storageState?.cookies.map((c) => c.name)).toEqual(["lab_session"]);
    const disk = allText(join(WORK, "access-store"));
    expect(disk).not.toContain(session.storageState?.cookies[0]?.value);
    expect(disk).not.toContain("lab-password");
  });

  it("a wrong sign-in is not saved, and says the block is still there", async () => {
    const result = await captureAccess({
      url: `${base}access/app/`,
      exegezisVersion: VERSION,
      headless: true,
      person: async (page) => {
        await page.getByLabel("User").fill("rene");
        await page.getByLabel("Password").fill("wrong");
        await page.getByRole("button", { name: "Sign in" }).click();
        await page.waitForLoadState();
      },
    });
    expect(result).toMatchObject({ ok: false, block: { kind: "LOGIN_WALL" } });
  });

  it("with the session: inspected in strict read-only; logout and the destructive GET are never visited, and listed", async () => {
    const before = await labGet<Stats>("__lab/access");
    const { report, dir } = await inspect("access/app/", { access: session, maxPages: 10, runs: 2 });
    const after = await labGet<Stats>("__lab/access");
    expect(report.status).toBe("COMPLETED");
    expect(report.options.strictReadonly).toBe(true);
    expect(report.access).toMatchObject({ session: true });
    expect(report.pages.filter((p) => p.run === 1).map((p) => new URL(p.url).pathname).sort()).toEqual(["/access/app/", "/access/app/profile"]);
    expect(after.logout - before.logout).toBe(0);
    expect(after.destructive - before.destructive).toBe(0);
    expect(report.skippedForSafety.map((s) => new URL(s.url).pathname).sort()).toEqual(["/access/app/delete-account", "/access/app/logout"]);
    // No value of the session anywhere in the inspection (report, network, DOM, console, trace…).
    expect(allText(dir)).not.toContain(session.storageState?.cookies[0]?.value);
  });

  it("an expired session is SESSION_EXPIRED; renewing it in the window makes the inspection work again", async () => {
    await labGet("__lab/expire-sessions");
    const { report } = await inspect("access/app/", { access: session });
    expect(kind(report)).toBe("SESSION_EXPIRED");
    const renewed = await captureAccess({ url: `${base}access/app/`, exegezisVersion: VERSION, person: signIn("rene", "lab-password"), headless: true });
    expect(renewed.ok).toBe(true);
    if (!renewed.ok) return;
    await store.put(`${base}access/app/`, { storageState: renewed.storageState });
    const again = await inspect("access/app/", { access: await saved("access/app/") });
    expect(again.report.status).toBe("COMPLETED");
  });
});

describe("SSO: only the site's cookies are kept", () => {
  it("after a login through an identity provider on another origin, its cookies are not saved and the session still works", async () => {
    const result = await captureAccess({
      url: `${base}access/sso-app/`,
      exegezisVersion: VERSION,
      headless: true,
      person: async (page) => {
        await page.getByLabel("Password").fill("idp-password");
        await page.getByRole("button", { name: "Continue" }).click();
        await page.waitForURL(/\/access\/sso-app\//);
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.storageState.cookies.some((c) => c.name === "idp_session")).toBe(true);
    await store.put(`${base}access/sso-app/`, { storageState: result.storageState });
    const access = await saved("access/sso-app/");
    expect(access.storageState?.cookies.map((c) => `${c.name}@${c.domain}`)).toEqual(["lab_session@127.0.0.1"]);
    expect((await inspect("access/sso-app/", { access })).report.status).toBe("COMPLETED");
  });
});

describe("HTTP_AUTH → credentials the person types → used as httpCredentials", () => {
  it("is HTTP_AUTH, then works with the saved credentials, which never reach the report", async () => {
    expect(kind((await inspect("access/basic/")).report)).toBe("HTTP_AUTH");
    await store.put(`${base}access/basic/`, { httpCredentials: { username: "rene", password: "basic-pass" } });
    const { report, dir } = await inspect("access/basic/", { access: await saved("access/basic/") });
    expect(report.status).toBe("COMPLETED");
    expect(report.access.httpCredentials).toBe(true);
    const text = allText(dir);
    expect(text).not.toContain("basic-pass");
    expect(text).not.toContain(Buffer.from("rene:basic-pass").toString("base64"));
  });
});

describe("BOT_CHALLENGE: never evaded; option A (WAF token) and option B (the person passes it)", () => {
  it("is BOT_CHALLENGE, with no retries against it", async () => {
    const { report } = await inspect("access/challenge/", { runs: 3 });
    expect(kind(report)).toBe("BOT_CHALLENGE");
    expect(report.pages.filter((p) => p.runPath !== null)).toHaveLength(1);
  });

  it("A: with the WAF token (the site's own rule) it passes; the token only goes to that origin and never into files", async () => {
    const token = "lab-waf-token-9f8e7d6c5b4a";
    await labGet(`__lab/waf-token?value=${token}`);
    await store.put(`${base}access/challenge/`, { wafToken: token });
    const before = await labGet<Stats>("__lab/access");
    const { report, dir } = await inspect("access/challenge/", { access: await saved("access/challenge/") });
    const after = await labGet<Stats>("__lab/access");
    expect(report.status).toBe("COMPLETED");
    expect(after.tokenToApp - before.tokenToApp).toBeGreaterThan(0);
    expect(after.tokenToThirdParty).toBe(0);
    expect(allText(dir)).not.toContain(token);
    await labGet("__lab/waf-token?value=");
  });

  it("B: the person passes the verification in the window, and that session is reused", async () => {
    await store.delete(`${base}access/challenge/`);
    const result = await captureAccess({
      url: `${base}access/challenge/`,
      exegezisVersion: VERSION,
      headless: true,
      person: async (page) => {
        await page.getByRole("button", { name: "I am human" }).click();
        await page.waitForSelector("text=Protected content");
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await store.put(`${base}access/challenge/`, { storageState: result.storageState });
    expect((await inspect("access/challenge/", { access: await saved("access/challenge/") })).report.status).toBe("COMPLETED");
  });
});

describe("CONSENT_WALL → the person chooses (the most private option) → saved", () => {
  it("is CONSENT_WALL, then clears once the choice is saved", async () => {
    expect(kind((await inspect("access/consent/")).report)).toBe("CONSENT_WALL");
    const result = await captureAccess({
      url: `${base}access/consent/`,
      exegezisVersion: VERSION,
      headless: true,
      person: async (page) => {
        await page.getByRole("button", { name: "Reject all" }).click();
        await page.waitForSelector("text=Article behind a consent wall");
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.storageState.cookies.find((c) => c.name === "lab_consent")?.value).toBe("necessary");
    await store.put(`${base}access/consent/`, { storageState: result.storageState });
    expect((await inspect("access/consent/", { access: await saved("access/consent/") })).report.status).toBe("COMPLETED");
  });
});

describe("RATE_LIMITED, FORBIDDEN", () => {
  it("waits out Retry-After, slows down and continues", async () => {
    const { report } = await inspect("access/limited/");
    expect(report.status).toBe("COMPLETED");
    expect(report.rateLimit.retries).toBeGreaterThanOrEqual(1);
    expect(report.rateLimit.waitedSeconds).toBeGreaterThanOrEqual(1);
  });

  it("stops when the site asks for more than the cap, and says how long to wait", async () => {
    const started = Date.now();
    const { report } = await inspect("access/limited-hard/");
    expect(Date.now() - started).toBeLessThan(60_000);
    const page = report.pages[0];
    expect(page?.block).toMatchObject({ kind: "RATE_LIMITED", retryAfterSeconds: 120 });
  });

  it("403 without a challenge is FORBIDDEN, with no retries", async () => {
    const { report } = await inspect("access/forbidden/", { runs: 3 });
    expect(kind(report)).toBe("FORBIDDEN");
    expect(report.pages.filter((p) => p.runPath !== null)).toHaveLength(1);
  });
});

describe("identity: nothing is disguised", () => {
  it("the User-Agent is EXEGEZIS-Inspector and navigator.webdriver is left as it is, in the inspection and in the access window", async () => {
    await inspect("access/fingerprint/");
    await captureAccess({ url: `${base}access/fingerprint/`, exegezisVersion: VERSION, headless: true, person: (page) => page.waitForTimeout(500) });
    const { fingerprints } = await labGet<Stats>("__lab/access");
    expect(fingerprints.length).toBeGreaterThanOrEqual(2);
    for (const f of fingerprints) {
      expect(f.header).toBe(`EXEGEZIS-Inspector/${VERSION}`);
      expect(f.navigatorUserAgent).toBe(`EXEGEZIS-Inspector/${VERSION}`);
      expect(f.webdriver).toBe("true");
    }
  });
});
