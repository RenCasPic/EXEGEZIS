import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AccessUnreadableError, systemProtector, type KeyProtector } from "./keystore.js";

/*
 * Saved access per origin (docs/09-access.md §2): a session (cookies and
 * storage of the site and its subdomains), HTTP credentials, a WAF token.
 * Each origin's secrets are one AES-256-GCM file; the 32-byte master key is
 * protected by the operating system. index.json holds metadata only.
 */

export const StorageState = z.object({
  cookies: z.array(
    z.looseObject({ name: z.string(), value: z.string(), domain: z.string(), path: z.string(), expires: z.number(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.string() }),
  ),
  origins: z.array(z.looseObject({ origin: z.string(), localStorage: z.array(z.object({ name: z.string(), value: z.string() })) })),
});
export type StorageState = z.infer<typeof StorageState>;

export const AccessSecrets = z.strictObject({
  storageState: StorageState.optional(),
  httpCredentials: z.strictObject({ username: z.string(), password: z.string() }).optional(),
  wafToken: z.string().optional(),
});
export type AccessSecrets = z.infer<typeof AccessSecrets>;

export type AccessKind = "session" | "httpCredentials" | "wafToken";

export const SiteSettings = z.strictObject({
  /** "This site is mine: also inspect what robots.txt excludes." */
  robotsOwner: z.boolean().default(false),
  /** Extra link patterns never visited with a session (added to the built-in list). */
  unsafeLinkPatterns: z.array(z.string()).default([]),
});
export type SiteSettings = z.infer<typeof SiteSettings>;

export const AccessEntry = z.strictObject({
  origin: z.string(),
  kinds: z.array(z.enum(["session", "httpCredentials", "wafToken"])),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastUsedAt: z.string().nullable(),
  /** Earliest expiry of the saved session cookies (null: session cookies without a date, or no session). */
  expiresAt: z.string().nullable(),
  /** The saved session hit a login wall: renew it. */
  expired: z.boolean().default(false),
  settings: SiteSettings.default({ robotsOwner: false, unsafeLinkPatterns: [] }),
});
export type AccessEntry = z.infer<typeof AccessEntry>;

const AccessIndex = z.strictObject({ schemaVersion: z.literal("exegezis.access-index/v1"), entries: z.array(AccessEntry) });

const MAGIC = Buffer.from("EXZA1");

export function defaultAccessDir(): string {
  const configured = process.env["EXEGEZIS_ACCESS_DIR"];
  if (configured !== undefined && configured !== "") return configured;
  switch (platform()) {
    case "win32":
      return join(process.env["LOCALAPPDATA"] ?? join(homedir(), "AppData", "Local"), "EXEGEZIS", "access");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "EXEGEZIS", "access");
    default:
      return join(process.env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share"), "exegezis", "access");
  }
}

export function normalizeOrigin(url: string): string {
  return new URL(url).origin;
}

/** The site a session belongs to: the origin's host without a leading "www.". */
export function siteOf(origin: string): string {
  return new URL(origin).hostname.replace(/^www\./, "").toLowerCase();
}

function belongs(host: string, site: string): boolean {
  const h = host.replace(/^\./, "").toLowerCase();
  return h === site || h.endsWith(`.${site}`);
}

/**
 * Keeps only the cookies and storage of the site and its subdomains. An
 * external identity provider's (Google, Microsoft, Auth0…) are dropped.
 */
export function scopeStorageState(state: StorageState, origin: string): StorageState {
  const site = siteOf(origin);
  return {
    cookies: state.cookies.filter((c) => belongs(c.domain, site)),
    origins: state.origins.filter((o) => {
      try {
        return belongs(new URL(o.origin).hostname, site);
      } catch {
        return false;
      }
    }),
  };
}

export function estimatedExpiry(state: StorageState | undefined): string | null {
  const dated = (state?.cookies ?? []).map((c) => c.expires).filter((e) => e > 0);
  return dated.length === 0 ? null : new Date(Math.min(...dated) * 1000).toISOString();
}

export class AccessStore {
  private key: Buffer | null = null;

  constructor(
    readonly dir: string = defaultAccessDir(),
    private readonly protector: KeyProtector = systemProtector(),
  ) {}

  private fileFor(origin: string): string {
    return join(this.dir, `${createHash("sha256").update(origin).digest("hex")}.bin`);
  }

  private async masterKey(): Promise<Buffer> {
    if (this.key !== null) return this.key;
    const path = join(this.dir, "master.key");
    const blob = await readFile(path).catch(() => null);
    if (blob !== null) {
      this.key = await this.protector.unprotect(blob);
      return this.key;
    }
    const fresh = randomBytes(32);
    const protectedBlob = await this.protector.protect(fresh);
    await mkdir(this.dir, { recursive: true });
    await writeFile(path, protectedBlob, { mode: 0o600 });
    this.key = fresh;
    return fresh;
  }

  async index(): Promise<AccessEntry[]> {
    try {
      return AccessIndex.parse(JSON.parse(await readFile(join(this.dir, "index.json"), "utf8"))).entries;
    } catch {
      return [];
    }
  }

  private async writeIndex(entries: AccessEntry[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `index.${process.pid}.tmp`);
    await writeFile(tmp, `${JSON.stringify({ schemaVersion: "exegezis.access-index/v1", entries: [...entries].sort((a, b) => a.origin.localeCompare(b.origin)) }, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, join(this.dir, "index.json"));
  }

  async entry(url: string): Promise<AccessEntry | null> {
    const origin = normalizeOrigin(url);
    return (await this.index()).find((e) => e.origin === origin) ?? null;
  }

  /** Decrypts an origin's secrets, in memory. null if nothing is saved. */
  async get(url: string): Promise<AccessSecrets | null> {
    const origin = normalizeOrigin(url);
    let data: Buffer;
    try {
      data = await readFile(this.fileFor(origin));
    } catch {
      return null;
    }
    const key = await this.masterKey();
    if (!data.subarray(0, MAGIC.length).equals(MAGIC)) throw new AccessUnreadableError("The saved access file is not an EXEGEZIS access file.");
    const iv = data.subarray(MAGIC.length, MAGIC.length + 12);
    const tag = data.subarray(MAGIC.length + 12, MAGIC.length + 28);
    const body = data.subarray(MAGIC.length + 28);
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(origin));
      decipher.setAuthTag(tag);
      return AccessSecrets.parse(JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")));
    } catch {
      throw new AccessUnreadableError("The saved access could not be decrypted with this user's key (another user, another computer, or a damaged file). Sign in again to create a new one.");
    }
  }

  /** Merges `patch` into the origin's secrets and saves them encrypted. The session is scoped to the site first. */
  async put(url: string, patch: AccessSecrets): Promise<AccessEntry> {
    const origin = normalizeOrigin(url);
    const current = (await this.get(url).catch(() => null)) ?? {};
    const next: AccessSecrets = { ...current, ...patch };
    if (next.storageState !== undefined) next.storageState = scopeStorageState(next.storageState, origin);
    const key = await this.masterKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(origin));
    const body = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(next), "utf8")), cipher.final()]);
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.fileFor(origin), Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]), { mode: 0o600 });

    const now = new Date().toISOString();
    const entries = await this.index();
    const previous = entries.find((e) => e.origin === origin);
    const kinds: AccessKind[] = [
      ...(next.storageState !== undefined ? (["session"] as const) : []),
      ...(next.httpCredentials !== undefined ? (["httpCredentials"] as const) : []),
      ...(next.wafToken !== undefined ? (["wafToken"] as const) : []),
    ];
    const entry: AccessEntry = {
      origin,
      kinds,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: previous?.lastUsedAt ?? null,
      expiresAt: estimatedExpiry(next.storageState),
      expired: patch.storageState !== undefined ? false : (previous?.expired ?? false),
      settings: previous?.settings ?? { robotsOwner: false, unsafeLinkPatterns: [] },
    };
    await this.writeIndex([...entries.filter((e) => e.origin !== origin), entry]);
    return entry;
  }

  /** Updates metadata only (last use, expired flag, site settings). */
  async touch(url: string, patch: Partial<Pick<AccessEntry, "lastUsedAt" | "expired" | "settings">>): Promise<void> {
    const origin = normalizeOrigin(url);
    const entries = await this.index();
    const previous = entries.find((e) => e.origin === origin);
    const now = new Date().toISOString();
    const base: AccessEntry = previous ?? { origin, kinds: [], createdAt: now, updatedAt: now, lastUsedAt: null, expiresAt: null, expired: false, settings: { robotsOwner: false, unsafeLinkPatterns: [] } };
    await this.writeIndex([...entries.filter((e) => e.origin !== origin), { ...base, ...patch, settings: { ...base.settings, ...patch.settings } }]);
  }

  async delete(url: string): Promise<boolean> {
    const origin = normalizeOrigin(url);
    const entries = await this.index();
    await rm(this.fileFor(origin), { force: true });
    await this.writeIndex(entries.filter((e) => e.origin !== origin));
    return entries.some((e) => e.origin === origin);
  }
}
