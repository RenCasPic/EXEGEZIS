import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccessStore, type KeyProtector } from "@exegezis/access";
import type { BlockInfo } from "@exegezis/core";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accessStatusAction } from "../src/app/access-actions";
import AccessSettingsPage from "../src/app/(app)/(shell)/settings/access/page";
import { BlockNotice } from "../src/components/access/block-notice";
import { accessState, deleteAccess, listAccess, setSiteSettings } from "../src/lib/access";
import { commandFor, JobRecord } from "../src/lib/jobs";

/*
 * docs/09-access.md §6: no cookie value, password or token ever reaches a
 * web response. The web reads index.json (metadata) and never decrypts.
 */

const SECRET_COOKIE = "s3ss10n-VALUE-must-never-leak";
const PASSWORD = "p4ssw0rd-must-never-leak";
const TOKEN = "waf-t0ken-must-never-leak";
const SECRETS = [SECRET_COOKIE, PASSWORD, TOKEN];

/** Test double: XOR "protection", clearly not for real use. */
const fakeProtector: KeyProtector = {
  name: "test",
  protect: (b) => Promise.resolve(Buffer.from(b.map((x) => x ^ 0xa5))),
  unprotect: (b) => Promise.resolve(Buffer.from(b.map((x) => x ^ 0xa5))),
};

const leaks = (text: string) => SECRETS.filter((s) => text.includes(s));

let dir: string;
const previous = process.env.EXEGEZIS_ACCESS_DIR;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "exegezis-web-access-"));
  process.env.EXEGEZIS_ACCESS_DIR = dir;
  const store = new AccessStore(dir, fakeProtector);
  await store.put("https://site.test/", {
    storageState: { cookies: [{ name: "session", value: SECRET_COOKIE, domain: "site.test", path: "/", expires: 1_900_000_000, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] },
    httpCredentials: { username: "ana", password: PASSWORD },
    wafToken: TOKEN,
  });
  await store.put("https://old.test/", {
    storageState: { cookies: [{ name: "sid", value: SECRET_COOKIE, domain: "old.test", path: "/", expires: 1_000_000_000, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] },
  });
});

afterAll(async () => {
  if (previous === undefined) delete process.env.EXEGEZIS_ACCESS_DIR;
  else process.env.EXEGEZIS_ACCESS_DIR = previous;
  await rm(dir, { recursive: true, force: true });
});

describe("saved access in the web", () => {
  it("lists metadata only, and knows an active from an expired session", async () => {
    const { entries } = await listAccess();
    expect(entries.map((e) => e.origin)).toEqual(["https://old.test", "https://site.test"]);
    expect(leaks(JSON.stringify(entries))).toEqual([]);
    const byOrigin = new Map(entries.map((e) => [e.origin, e]));
    expect(accessState(byOrigin.get("https://site.test")!, Date.parse("2026-09-27T00:00:00Z"))).toBe("active");
    expect(accessState(byOrigin.get("https://old.test")!, Date.parse("2026-09-27T00:00:00Z"))).toBe("expired");
  });

  it("the home status action answers with kinds and expiry, never a secret", async () => {
    const status = await accessStatusAction("https://site.test/some/page");
    expect(status).not.toBeNull();
    expect(Object.keys(status!).sort()).toEqual(["expired", "expiresAt", "kinds", "origin"]);
    expect(status!.kinds.sort()).toEqual(["httpCredentials", "session", "wafToken"]);
    expect(leaks(JSON.stringify(status))).toEqual([]);
    expect((await accessStatusAction("https://old.test/"))?.expired).toBe(true);
    expect(await accessStatusAction("https://unknown.test/")).toBeNull();
    expect(await accessStatusAction("not a url")).toBeNull();
  });

  it("Settings → Accesos shows sites, state and the per-user note, without any secret", async () => {
    const html = renderToStaticMarkup(await AccessSettingsPage());
    expect(html).toContain("https://site.test");
    expect(html).toContain(">Activo<");
    expect(html).toContain(">Caducado<");
    expect(html).toContain('title="Código técnico: EXPIRED"');
    expect(html).toContain("Renovar sesión");
    expect(leaks(html)).toEqual([]);
    if (process.platform === "win32") expect(html).toContain("solo se abren con este usuario de Windows en este equipo");
  });

  it("changing a site setting keeps its secrets encrypted and untouched", async () => {
    const file = (await readdir(dir)).find((f) => f.endsWith(".bin") && f !== "master.key")!;
    const before = await readFile(join(dir, file));
    await setSiteSettings("https://site.test/", { robotsOwner: true });
    expect((await listAccess()).entries.find((e) => e.origin === "https://site.test")?.settings.robotsOwner).toBe(true);
    for (const f of await readdir(dir)) expect(leaks((await readFile(join(dir, f))).toString("latin1"))).toEqual([]);
    expect(before.length).toBeGreaterThan(0);
  });

  it("deleting a site removes its encrypted file", async () => {
    const count = async () => (await readdir(dir)).filter((f) => f.endsWith(".bin")).length;
    const n = await count();
    await deleteAccess("https://old.test/");
    expect(await count()).toBe(n - 1);
    expect((await listAccess()).entries.map((e) => e.origin)).toEqual(["https://site.test"]);
  });
});

describe("the block notice and the anonymous option", () => {
  it("shows cookie names as evidence, never values", () => {
    const block: BlockInfo = {
      kind: "SESSION_EXPIRED",
      detail: "the saved session hit a login page",
      retryAfterSeconds: null,
      evidence: { finalUrl: "https://site.test/login", httpStatus: 200, headers: {}, markers: ["password field"], cookieNames: ["session"], screenshot: null },
    };
    const html = renderToStaticMarkup(<BlockNotice block={block} origin="https://site.test" inspectionId={null} relaunchJobId={null} hasWafToken={false} />);
    expect(html).toContain("session");
    expect(leaks(html)).toEqual([]);
  });

  it("an inspection job marked anonymous runs with --no-session", () => {
    const job = JobRecord.parse({
      schemaVersion: "exegezis.web-job/v1",
      kind: "inspect",
      id: "01JZ0000000000000000000000",
      startedAt: "2026-09-27T00:00:00.000Z",
      error: null,
      status: "running",
      pid: null,
      exitCode: null,
      finishedAt: null,
      url: "https://site.test/",
      runs: 3,
      maxPages: null,
      maxDepth: null,
      checks: [],
      storageState: null,
      strictReadonly: false,
      ignoreRobots: false,
      browserChannel: "auto",
      noSession: true,
    });
    expect(commandFor(job)).toContain("--no-session");
  });
});
