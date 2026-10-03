import { createServer } from "node:net";
import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  checkLimits,
  connect,
  consumeRateLimit,
  deleteUser,
  exportAccount,
  getProfile,
  joinWaitlist,
  LIMITS,
  ownsRun,
  passwordProblems,
  PRIVACY_VERSION,
  recordRun,
  safeNext,
  setPlan,
  TERMS_VERSION,
  updateProfile,
  usage,
  type Sql,
} from "../src/index.js";
import { PLANS } from "../src/pricing.js";
import { createUser, testDatabase } from "./database.js";

/*
 * Row Level Security with two users on a real Postgres (PGlite) with the
 * migrations of supabase/migrations: A never reads, changes or deletes
 * anything of B's, through the same store the app uses.
 */

let db: PGlite;
let server: PGLiteSocketServer;
let sql: Sql;
let a = "";
let b = "";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => resolve(typeof addr === "object" && addr !== null ? addr.port : 0));
    });
  });
}

beforeAll(async () => {
  db = await testDatabase();
  const port = await freePort();
  server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  sql = connect(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1 });
  a = await createUser(db, "ana@example.com", { name: "Ana", locale: "es", terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION });
  b = await createUser(db, "bea@example.com", { name: "Bea" });
  await recordRun(sql, a, { id: "01J0000000000000000000000A", kind: "inspection", targetUrl: "https://www.ana.example/", pagesRequested: 20 });
  await recordRun(sql, b, { id: "01J0000000000000000000000B", kind: "inspection", targetUrl: "https://bea.example/", pagesRequested: 10 });
  await joinWaitlist(sql, b, "bea@example.com", "pro");
  await asUser(sql, b, async (tx) => {
    await tx`insert into public.projects (user_id, name) values (${b}, 'tienda')`;
  });
});

afterAll(async () => {
  await sql.end();
  await server.stop();
  await db.close();
});

describe("new accounts", () => {
  it("get a Free profile with the sign-up data, and the accepted legal versions with their date", async () => {
    const p = await getProfile(sql, a);
    expect(p).toMatchObject({ displayName: "Ana", locale: "es", plan: "free", termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
    expect(p?.termsAcceptedAt).not.toBeNull();
    const consents = await asUser(sql, a, async (tx) => tx`select document, version from public.consents order by document`);
    expect([...consents]).toEqual([
      { document: "privacy", version: PRIVACY_VERSION },
      { document: "terms", version: TERMS_VERSION },
    ]);
  });
});

describe("Row Level Security: A never sees, changes or deletes B's data", () => {
  it("reads only its own rows in every table", async () => {
    await asUser(sql, a, async (tx) => {
      for (const table of ["profiles", "consents", "projects", "runs", "waitlist"]) {
        const rows = await tx.unsafe(`select * from public.${table}`);
        for (const row of rows) expect(row["user_id"] ?? row["id"], table).toBe(a);
      }
      expect((await tx`select * from public.profiles where id = ${b}`).length).toBe(0);
      expect((await tx`select * from public.runs where user_id = ${b}`).length).toBe(0);
    });
    expect(await ownsRun(sql, a, "01J0000000000000000000000B")).toBe(false);
    expect(await ownsRun(sql, a, "01J0000000000000000000000A")).toBe(true);
  });

  it("cannot update or delete B's rows (nothing is touched)", async () => {
    await asUser(sql, a, async (tx) => {
      expect((await tx`update public.runs set status = 'failed' where id = '01J0000000000000000000000B'`).count).toBe(0);
      expect((await tx`delete from public.runs where user_id = ${b}`).count).toBe(0);
      expect((await tx`delete from public.projects`).count).toBe(0);
      expect((await tx`update public.profiles set display_name = 'x' where id = ${b}`).count).toBe(0);
      expect((await tx`delete from public.waitlist`).count).toBe(0);
    });
    const still = await db.query<{ status: string }>("select status from public.runs where id = '01J0000000000000000000000B'");
    expect(still.rows[0]?.status).toBe("queued");
    expect((await db.query("select * from public.projects")).rows.length).toBe(1);
  });

  it("cannot write rows in B's name", async () => {
    await expect(asUser(sql, a, async (tx) => tx`insert into public.runs (id, user_id, kind, target_url, site) values ('x1', ${b}, 'inspection', 'https://x.example', 'x.example')`)).rejects.toThrow(/row-level security/);
    await expect(asUser(sql, a, async (tx) => tx`insert into public.projects (user_id, name) values (${b}, 'p')`)).rejects.toThrow(/row-level security/);
    await expect(asUser(sql, a, async (tx) => tx`insert into public.waitlist (user_id, email, plan) values (${b}, 'a@example.com', 'pro')`)).rejects.toThrow(/row-level security/);
    await expect(asUser(sql, a, async (tx) => tx`update public.runs set user_id = ${b} where id = '01J0000000000000000000000A'`)).rejects.toThrow(/row-level security/);
  });

  it("cannot give itself a plan, write consents or touch the rate limits", async () => {
    await expect(asUser(sql, a, async (tx) => tx`update public.profiles set plan = 'enterprise' where id = ${a}`)).rejects.toThrow(/permission denied/);
    await expect(asUser(sql, a, async (tx) => tx`insert into public.consents (user_id, document, version) values (${a}, 'terms', 'v')`)).rejects.toThrow(/permission denied/);
    await expect(asUser(sql, a, async (tx) => tx`select * from public.rate_limits`)).rejects.toThrow(/permission denied/);
    expect((await getProfile(sql, a))?.plan).toBe("free");
  });

  it("an anonymous visitor reads nothing", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role anon`;
        return tx`select * from public.runs`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("updates its own profile, but not its plan", async () => {
    await updateProfile(sql, a, { displayName: "Ana M.", theme: "dark" });
    expect(await getProfile(sql, a)).toMatchObject({ displayName: "Ana M.", theme: "dark", locale: "es", plan: "free" });
  });

  it("exports only its own data", async () => {
    const json = JSON.stringify(await exportAccount(sql, a));
    expect(json).toContain("ana.example");
    expect(json).not.toContain("bea");
    expect(json).not.toContain(b);
  });
});

describe("plan limits (checked on the server before any job starts)", () => {
  it("usage counts this month's inspections, pages and sites", async () => {
    expect(await usage(sql, a)).toEqual({ inspections: 1, pages: 20, aiUsd: 0, sites: ["ana.example"] });
  });

  it("Free: 5 inspections a month, 20 pages, 1 site, no search by meaning", () => {
    const used = { inspections: 1, pages: 20, aiUsd: 0, sites: ["ana.example"] };
    expect(checkLimits("free", used, { kind: "inspection", url: "https://ana.example/x", pages: 20 })).toEqual({ ok: true });
    expect(checkLimits("free", used, { kind: "inspection", url: "https://ana.example/", pages: 21 })).toEqual({ ok: false, reason: "pagesPerInspection", limit: 20 });
    expect(checkLimits("free", used, { kind: "inspection", url: "https://other.example/", pages: 5 })).toEqual({ ok: false, reason: "sites", limit: 1 });
    expect(checkLimits("free", { ...used, inspections: 5 }, { kind: "inspection", url: "https://ana.example/", pages: 5 })).toEqual({ ok: false, reason: "inspectionsPerMonth", limit: 5 });
    expect(checkLimits("free", used, { kind: "search", url: "https://ana.example/", pages: 5, meaning: { usd: 0.01 } })).toEqual({ ok: false, reason: "meaningSearch", limit: false });
    expect(checkLimits("pro", used, { kind: "search", url: "https://ana.example/", pages: 5, meaning: { usd: 6 } })).toEqual({ ok: false, reason: "aiBalance", limit: 5 });
  });

  it("the landing's cards show the same numbers the server enforces", () => {
    const free = PLANS.find((p) => p.id === "free");
    expect(free?.limits).toBe(LIMITS.free);
    expect(free?.features.find((f) => f.id === "pages")?.values?.["count"]).toBe(LIMITS.free.pagesPerInspection);
    expect(free?.features.find((f) => f.id === "inspectionsPerMonth")?.values?.["count"]).toBe(LIMITS.free.inspectionsPerMonth);
    expect(free?.features.find((f) => f.id === "sites")?.values?.["count"]).toBe(LIMITS.free.sites);
  });

  it("only the operator changes a plan", async () => {
    await setPlan(sql, b, "pro");
    expect((await getProfile(sql, b))?.plan).toBe("pro");
  });
});

describe("rate limits", () => {
  it("allows `limit` attempts per window, then refuses with the wait", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(sql, "signin:1.2.3.4", 3, 600));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.retryAfterSeconds).toBeGreaterThan(0);
    expect((await consumeRateLimit(sql, "signin:5.6.7.8", 3, 600)).allowed).toBe(true);
  });
});

describe("helpers", () => {
  it("`next` only goes to a path of this app", () => {
    expect(safeNext("/inspections?x=1#a")).toBe("/inspections?x=1#a");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil", "/\u0000x", "", null, undefined]) expect(safeNext(bad), String(bad)).toBe("/");
  });

  it("passwords: at least 10 characters, at most 72 bytes, not the email, not one repeated character", () => {
    expect(passwordProblems("corto")).toEqual(["short"]);
    expect(passwordProblems("una frase larga y segura")).toEqual([]);
    expect(passwordProblems("aaaaaaaaaaaa")).toEqual(["repeated"]);
    expect(passwordProblems("anamaria-2026", "anamaria@example.com")).toEqual(["email"]);
    expect(passwordProblems("ñ".repeat(40))).toContain("long");
  });
});

describe("deleting an account", () => {
  it("removes the user and, by cascade, every row of theirs", async () => {
    await deleteUser(sql, b);
    for (const table of ["profiles", "projects", "runs", "waitlist", "consents"]) {
      const rows = await db.query(`select * from public.${table} where ${table === "profiles" ? "id" : "user_id"} = $1`, [b]);
      expect(rows.rows.length, table).toBe(0);
    }
    expect((await db.query("select * from auth.users where id = $1", [b])).rows.length).toBe(0);
    expect(await getProfile(sql, a)).not.toBeNull();
  });
});
