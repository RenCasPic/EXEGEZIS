import { createServer } from "node:net";
import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptLegal,
  adoptRuns,
  checkLimits,
  consumeRateLimit,
  deleteUser,
  exportAccount,
  findClaimant,
  getProfile,
  joinWaitlist,
  LIMITS,
  ownsRun,
  passwordProblems,
  PRIVACY_VERSION,
  recordRun,
  safeNext,
  serviceClient,
  setPlan,
  TERMS_VERSION,
  updateProfile,
  usage,
  type Database,
  type Db,
} from "../src/index.js";
import { PLANS } from "../src/pricing.js";
import { createUser, testDatabase } from "./database.js";
import { startRestStandin, userToken } from "./rest-standin.js";

/*
 * Row Level Security with two users on a real Postgres (PGlite) with
 * supabase/setup.sql, through Supabase's Data API as the app uses it (a
 * stand-in of it: rest-standin.ts): each user with her own session, the
 * operator with the service role key. Ana never reads, changes or deletes
 * anything of Bea's.
 */

let db: PGlite;
let server: PGLiteSocketServer;
let rest: Awaited<ReturnType<typeof startRestStandin>>;
let asAna: Db;
let asBea: Db;
let anon: Db;
let admin: Db;
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

const as = (userId: string): Db => createClient<Database>(rest.url, rest.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${userToken(userId)}` } } });

beforeAll(async () => {
  db = await testDatabase();
  const port = await freePort();
  server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  rest = await startRestStandin(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`);
  a = await createUser(db, "ana@example.com", { name: "Ana", locale: "es", terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION });
  b = await createUser(db, "bea@example.com", { name: "Bea" });
  asAna = as(a);
  asBea = as(b);
  anon = createClient<Database>(rest.url, rest.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  admin = serviceClient(rest.url, rest.serviceRoleKey);
  await recordRun(asAna, a, { id: "01J0000000000000000000000A", kind: "inspection", targetUrl: "https://www.ana.example/", pagesRequested: 20 });
  await recordRun(asBea, b, { id: "01J0000000000000000000000B", kind: "inspection", targetUrl: "https://bea.example/", pagesRequested: 10 });
  await joinWaitlist(asBea, b, "bea@example.com", "pro");
  await joinWaitlist(asBea, b, "bea@example.com", "pro");
  expect((await asBea.from("projects").insert({ user_id: b, name: "tienda" })).error).toBeNull();
});

afterAll(async () => {
  await rest.close();
  await server.stop();
  await db.close();
});

describe("new accounts", () => {
  it("get a Free profile with the sign-up data, and the accepted legal versions with their date", async () => {
    const p = await getProfile(asAna, a);
    expect(p).toMatchObject({ displayName: "Ana", locale: "es", plan: "free", termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
    expect(p?.termsAcceptedAt).not.toBeNull();
    const consents = await asAna.from("consents").select("document, version").order("document");
    expect(consents.data).toEqual([
      { document: "privacy", version: PRIVACY_VERSION },
      { document: "terms", version: TERMS_VERSION },
    ]);
  });

  it("an OAuth sign-up accepts the legal texts afterwards (accept_legal)", async () => {
    expect((await getProfile(asBea, b))?.termsVersion).toBeNull();
    await acceptLegal(asBea, TERMS_VERSION, PRIVACY_VERSION);
    expect(await getProfile(asBea, b)).toMatchObject({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
  });
});

describe("Row Level Security: Ana never sees, changes or deletes Bea's data", () => {
  it("reads only her own rows in every table", async () => {
    for (const table of ["profiles", "consents", "projects", "runs", "waitlist"] as const) {
      const { data, error } = await asAna.from(table).select("*");
      expect(error, table).toBeNull();
      for (const row of data ?? []) expect((row as Record<string, unknown>)["user_id"] ?? (row as Record<string, unknown>)["id"], table).toBe(a);
    }
    expect((await asAna.from("profiles").select("*").eq("id", b)).data).toEqual([]);
    expect((await asAna.from("runs").select("*").eq("user_id", b)).data).toEqual([]);
    expect(await ownsRun(asAna, "01J0000000000000000000000B")).toBe(false);
    expect(await ownsRun(asAna, "01J0000000000000000000000A")).toBe(true);
  });

  it("cannot update or delete Bea's rows (nothing is touched)", async () => {
    expect((await asAna.from("runs").update({ status: "failed" }).eq("id", "01J0000000000000000000000B").select()).data).toEqual([]);
    expect((await asAna.from("runs").delete().eq("user_id", b).select()).data).toEqual([]);
    expect((await asAna.from("projects").delete().neq("name", "").select()).data).toEqual([]);
    expect((await asAna.from("profiles").update({ display_name: "x" }).eq("id", b).select("id")).data).toEqual([]);
    expect((await asAna.from("waitlist").delete().neq("plan", "").select()).data).toEqual([]);
    const still = await db.query<{ status: string }>("select status from public.runs where id = '01J0000000000000000000000B'");
    expect(still.rows[0]?.status).toBe("queued");
    expect((await db.query("select * from public.projects")).rows.length).toBe(1);
  });

  it("cannot write rows in Bea's name", async () => {
    expect((await asAna.from("runs").insert({ id: "x1", user_id: b, kind: "inspection", target_url: "https://x.example", site: "x.example" })).error?.message).toMatch(/row-level security/);
    expect((await asAna.from("projects").insert({ user_id: b, name: "p" })).error?.message).toMatch(/row-level security/);
    expect((await asAna.from("waitlist").insert({ user_id: b, email: "a@example.com", plan: "pro" })).error?.message).toMatch(/row-level security/);
    expect((await asAna.from("runs").update({ user_id: b }).eq("id", "01J0000000000000000000000A")).error?.message).toMatch(/row-level security/);
  });

  it("cannot give herself a plan, write consents, touch the rate limits or call the operator's functions", async () => {
    expect((await asAna.from("profiles").update({ plan: "enterprise" }).eq("id", a)).error?.message).toMatch(/permission denied/);
    expect((await asAna.from("consents").insert({ user_id: a, document: "terms", version: "v" })).error?.message).toMatch(/permission denied/);
    expect((await asAna.from("rate_limits").select("*")).error?.message).toMatch(/permission denied/);
    expect((await asAna.rpc("consume_rate_limit", { p_key: "x", p_limit: 1, p_window_seconds: 1 })).error?.message).toMatch(/permission denied/);
    expect((await getProfile(asAna, a))?.plan).toBe("free");
  });

  it("an anonymous visitor (the public anon key alone) reads nothing", async () => {
    for (const table of ["profiles", "runs", "waitlist"] as const) expect((await anon.from(table).select("*")).error?.message, table).toMatch(/permission denied/);
  });

  it("updates her own profile, but not her plan", async () => {
    await updateProfile(asAna, a, { displayName: "Ana M.", theme: "dark" });
    expect(await getProfile(asAna, a)).toMatchObject({ displayName: "Ana M.", theme: "dark", locale: "es", plan: "free" });
  });

  it("exports only her own data", async () => {
    const json = JSON.stringify(await exportAccount(asAna));
    expect(json).toContain("ana.example");
    expect(json).not.toContain("bea");
    expect(json).not.toContain(b);
  });
});

describe("plan limits (checked on the server before any job starts)", () => {
  it("usage counts this month's inspections, pages and sites", async () => {
    expect(await usage(asAna)).toEqual({ inspections: 1, pages: 20, aiUsd: 0, sites: ["ana.example"] });
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
    await setPlan(admin, b, "pro");
    expect((await getProfile(asBea, b))?.plan).toBe("pro");
  });
});

describe("rate limits (the operator's client)", () => {
  it("allows `limit` attempts per window, then refuses with the wait", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(admin, "signin:1.2.3.4", 3, 600));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.retryAfterSeconds).toBeGreaterThan(0);
    expect((await consumeRateLimit(admin, "signin:5.6.7.8", 3, 600)).allowed).toBe(true);
  });
});

describe("the CLI's claim-local (the operator's client)", () => {
  it("finds the first account or one by email, and records runs once", async () => {
    expect(await findClaimant(admin, null)).toEqual({ id: a, email: "ana@example.com" });
    expect(await findClaimant(admin, "BEA@example.com")).toEqual({ id: b, email: "bea@example.com" });
    expect(await findClaimant(admin, "nadie@example.com")).toBeNull();
    const runs = [{ id: "01J00000000000000000000CLI", kind: "inspection" as const, targetUrl: "https://ana.example/cli", createdAt: "2026-09-01T10:00:00.000Z", pagesRequested: 20 }];
    expect(await adoptRuns(admin, a, runs)).toBe(1);
    expect(await adoptRuns(admin, a, runs)).toBe(0);
    expect(await ownsRun(asAna, "01J00000000000000000000CLI")).toBe(true);
    expect(await ownsRun(asBea, "01J00000000000000000000CLI")).toBe(false);
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
    await deleteUser(admin, b);
    for (const table of ["profiles", "projects", "runs", "waitlist", "consents"]) {
      const rows = await db.query(`select * from public.${table} where ${table === "profiles" ? "id" : "user_id"} = $1`, [b]);
      expect(rows.rows.length, table).toBe(0);
    }
    expect((await db.query("select * from auth.users where id = $1", [b])).rows.length).toBe(0);
    expect(await getProfile(asAna, a)).not.toBeNull();
  });
});
