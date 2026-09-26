import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessStore, DpapiProtector, KeystoreUnavailableError, scopeStorageState, SecretToolProtector, type KeyProtector, type StorageState } from "../src/index.js";

const SECRET_COOKIE = "s3ss10n-VALUE-must-never-leak";
const PASSWORD = "p4ssw0rd-must-never-leak";
const TOKEN = "waf-t0ken-must-never-leak";

const cookie = (name: string, domain: string, value = SECRET_COOKIE, expires = -1) => ({ name, value, domain, path: "/", expires, httpOnly: true, secure: true, sameSite: "Lax" });

/** A session after a login that went through an external identity provider. */
const SSO_STATE: StorageState = {
  cookies: [
    cookie("session", "www.site.test", SECRET_COOKIE, 1_900_000_000),
    cookie("remember", ".site.test", "r3m", 1_800_000_000),
    cookie("api", "api.site.test"),
    cookie("SID", ".accounts.google.com"),
    cookie("auth0", "tenant.auth0.com"),
    cookie("evil", "notsite.test"),
  ],
  origins: [
    { origin: "https://www.site.test", localStorage: [{ name: "token", value: "local" }] },
    { origin: "https://login.microsoftonline.com", localStorage: [{ name: "msal", value: "x" }] },
  ],
};

/** Test double for platforms other than Windows: XOR "protection", clearly not for real use. */
const fakeProtector: KeyProtector = {
  name: "test",
  protect: async (b) => Buffer.from(b.map((x) => x ^ 0xa5)),
  unprotect: async (b) => Buffer.from(b.map((x) => x ^ 0xa5)),
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "exegezis-access-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function allBytes(): Promise<string> {
  const files = await readdir(dir);
  const contents = await Promise.all(files.map((f) => readFile(join(dir, f))));
  return contents.map((c) => c.toString("latin1")).join("\n");
}

describe("session scope: the site and its subdomains only", () => {
  it("drops the identity provider's cookies and storage (SSO)", () => {
    const scoped = scopeStorageState(SSO_STATE, "https://www.site.test");
    expect(scoped.cookies.map((c) => c.name)).toEqual(["session", "remember", "api"]);
    expect(scoped.origins.map((o) => o.origin)).toEqual(["https://www.site.test"]);
  });
});

describe("the encrypted store", () => {
  const protector = platform() === "win32" ? new DpapiProtector() : fakeProtector;

  it(`round-trips secrets per origin with ${protector.name}, and nothing on disk is readable`, async () => {
    const store = new AccessStore(dir, protector);
    const entry = await store.put("https://www.site.test/prayer", { storageState: SSO_STATE, httpCredentials: { username: "rene", password: PASSWORD }, wafToken: TOKEN });
    expect(entry).toMatchObject({ origin: "https://www.site.test", kinds: ["session", "httpCredentials", "wafToken"], expiresAt: new Date(1_800_000_000 * 1000).toISOString() });

    const back = await new AccessStore(dir, protector).get("https://www.site.test/other");
    expect(back?.httpCredentials?.password).toBe(PASSWORD);
    expect(back?.wafToken).toBe(TOKEN);
    expect(back?.storageState?.cookies.map((c) => c.name)).toEqual(["session", "remember", "api"]);

    const disk = await allBytes();
    for (const secret of [SECRET_COOKIE, PASSWORD, TOKEN, "rene", "r3m"]) expect(disk).not.toContain(secret);
    // The index is metadata only.
    const index = await readFile(join(dir, "index.json"), "utf8");
    expect(index).toContain("https://www.site.test");
    const fields = Object.keys((JSON.parse(index) as { entries: Record<string, unknown>[] }).entries[0] ?? {}).sort();
    expect(fields).toEqual(["createdAt", "expired", "expiresAt", "kinds", "lastUsedAt", "origin", "settings", "updatedAt"]);
  });

  it("a file encrypted for another origin cannot be swapped in (the origin is authenticated)", async () => {
    const store = new AccessStore(dir, protector);
    await store.put("https://a.test", { wafToken: TOKEN });
    await store.put("https://b.test", { wafToken: "other" });
    const files = (await readdir(dir)).filter((f) => f.endsWith(".bin"));
    const [fa, fb] = files as [string, string];
    await writeFile(join(dir, fb), await readFile(join(dir, fa)));
    const results = await Promise.allSettled([store.get("https://a.test"), store.get("https://b.test")]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("delete removes the secrets and the entry; the metadata never had them", async () => {
    const store = new AccessStore(dir, protector);
    await store.put("https://www.site.test", { wafToken: TOKEN });
    expect(await store.delete("https://www.site.test")).toBe(true);
    expect(await store.get("https://www.site.test")).toBeNull();
    expect(await store.index()).toEqual([]);
  });

  it.runIf(platform() === "win32")("DPAPI: a key protected for another user (or a damaged key) gives a clear message, not a cryptic error", async () => {
    const store = new AccessStore(dir, new DpapiProtector());
    await store.put("https://www.site.test", { wafToken: TOKEN });
    const keyFile = join(dir, "master.key");
    const blob = await readFile(keyFile);
    blob[blob.length - 5] = (blob[blob.length - 5] ?? 0) ^ 0xff;
    await writeFile(keyFile, blob);
    await expect(new AccessStore(dir, new DpapiProtector()).get("https://www.site.test")).rejects.toMatchObject({
      name: "AccessUnreadableError",
      message: expect.stringMatching(/another Windows user or on another computer/),
    });
  });

  it("without secret-tool on Linux (or any unavailable keystore): nothing is saved, and the message says how to install it", async () => {
    // secret-tool does not exist on this Windows test machine, exactly like a Linux without libsecret-tools.
    const store = new AccessStore(dir, platform() === "linux" ? { name: "missing", protect: () => Promise.reject(new KeystoreUnavailableError("secret-tool (libsecret) is not installed … sudo apt install libsecret-tools")), unprotect: () => Promise.reject(new Error("x")) } : new SecretToolProtector());
    await expect(store.put("https://www.site.test", { wafToken: TOKEN })).rejects.toMatchObject({ name: "KeystoreUnavailableError", message: expect.stringMatching(/libsecret-tools/) });
    expect((await readdir(dir)).filter((f) => f.endsWith(".bin") || f === "master.key")).toEqual([]);
  });
});
