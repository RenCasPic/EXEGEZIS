import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { setupSql } from "./database.js";

const REPO = join(import.meta.dirname, "..", "..", "..");

describe("supabase/setup.sql (pasted in Supabase's SQL Editor)", () => {
  it("is the migrations, up to date (`pnpm db:setup` writes it)", () => {
    const expected = execFileSync(process.execPath, ["--input-type=module", "-e", "import { setupSql } from './scripts/db-setup.mjs'; process.stdout.write(setupSql());"], { cwd: REPO, encoding: "utf8" });
    expect(setupSql()).toBe(expected);
  });

  it("can be applied twice: on a new project and again on one that already has it", async () => {
    const db = new PGlite();
    await db.exec(readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
    await db.exec(setupSql());
    await db.exec(setupSql());
    const tables = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by table_name");
    expect(tables.rows.map((r) => r.table_name)).toEqual(["consents", "profiles", "projects", "rate_limits", "runs", "waitlist"]);
    const fn = await db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname = 'consume_rate_limit'");
    expect(fn.rows[0]?.n).toBe(1);
    await db.close();
  });
});
