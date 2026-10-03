import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { AccessStore, osProtector, ServerKeyProtector } from "@exegezis/access";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUser, testDatabase } from "../../../packages/accounts/test/database.js";
import { main } from "../src/main.js";
import type { CliIo } from "../src/shared.js";

/*
 * `exegezis account claim-local` on a real Postgres (PGlite): the local runs,
 * saved accesses and search settings become the first account's — copied,
 * re-encrypted with the cloud key, recorded in the database.
 */

let db: PGlite;
let server: PGLiteSocketServer;
let work = "";
let url = "";

function io(): CliIo & { out: () => string; err: () => string } {
  let out = "";
  let err = "";
  return {
    stdout: { write: (s: string) => ((out += s), true) },
    stderr: { write: (s: string) => ((err += s), true) },
    out: () => out,
    err: () => err,
  } as unknown as CliIo & { out: () => string; err: () => string };
}

beforeAll(async () => {
  db = await testDatabase();
  const port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => resolve(typeof a === "object" && a !== null ? a.port : 0));
    });
  });
  server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  work = await mkdtemp(join(tmpdir(), "exegezis-claim-"));
});

afterAll(async () => {
  await server.stop();
  await db.close();
  await rm(work, { recursive: true, force: true });
});

describe("exegezis account claim-local", () => {
  it("refuses outside cloud mode", async () => {
    const o = io();
    expect(await main(["--lang", "en", "account", "claim-local"], o, { EXEGEZIS_MODE: "local" })).toBe(2);
    expect(o.err()).toContain("cloud mode");
  });

  it("says so when there is no account yet", async () => {
    const o = io();
    expect(await main(["--lang", "en", "account", "claim-local"], o, { EXEGEZIS_MODE: "cloud", DATABASE_URL: url })).toBe(1);
    expect(o.err()).toContain("no account yet");
  });

  it("gives the runs, the saved accesses and the search settings to the first account", async () => {
    const runs = join(work, "runs");
    const inspection = join(runs, "inspections", "01J00000000000000000000INS");
    await mkdir(inspection, { recursive: true });
    await writeFile(join(inspection, "inspection-report.json"), JSON.stringify({ target: { url: "https://www.example.com/" }, startedAt: "2026-09-01T10:00:00.000Z", options: { maxPages: 20 } }));
    const searchDir = join(work, "search");
    await mkdir(searchDir, { recursive: true });
    await writeFile(join(searchDir, "settings.json"), JSON.stringify({ maxCostUsd: 1 }));
    const accessDir = join(work, "access");
    const local = new AccessStore(accessDir, osProtector());
    await local.put("https://intranet.example.com", { httpCredentials: { username: "ana", password: "s3cret-pass" } });

    const first = await createUser(db, "first@example.com");
    await createUser(db, "second@example.com");
    const key = randomBytes(32).toString("base64");
    const env = {
      EXEGEZIS_MODE: "cloud",
      DATABASE_URL: url,
      EXEGEZIS_DATA_DIR: join(work, "data"),
      EXEGEZIS_RUNS_DIR: runs,
      EXEGEZIS_SEARCH_DIR: searchDir,
      EXEGEZIS_ACCESS_DIR: accessDir,
      EXEGEZIS_ACCESS_KEY: key,
    };
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      const dry = io();
      expect(await main(["--lang", "en", "account", "claim-local", "--dry-run"], dry, env)).toBe(0);
      expect(dry.out()).toContain("first@example.com");
      expect(existsSync(join(work, "data"))).toBe(false);

      const o = io();
      expect(await main(["--lang", "en", "account", "claim-local"], o, env)).toBe(0);
      expect(o.out()).toContain("1 run recorded");
      const root = join(work, "data", "users", first);
      expect(existsSync(join(root, "runs", "inspections", "01J00000000000000000000INS", "inspection-report.json"))).toBe(true);
      expect(existsSync(join(root, "search", "settings.json"))).toBe(true);
      // Re-encrypted with the cloud key: readable with it, the password intact.
      const cloud = new AccessStore(join(root, "access"), new ServerKeyProtector(key));
      expect((await cloud.get("https://intranet.example.com"))?.httpCredentials).toEqual({ username: "ana", password: "s3cret-pass" });
      // The originals stay for local mode.
      expect(existsSync(join(inspection, "inspection-report.json"))).toBe(true);
      const rows = await db.query<{ id: string; user_id: string; kind: string; site: string }>("select id, user_id, kind, site from public.runs");
      expect(rows.rows).toEqual([{ id: "01J00000000000000000000INS", user_id: first, kind: "inspection", site: "example.com" }]);

      // Again: nothing new, nothing duplicated.
      const again = io();
      expect(await main(["--lang", "en", "account", "claim-local"], again, env)).toBe(0);
      expect(again.out()).toContain("0 runs recorded");
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});
