import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const REPO = join(import.meta.dirname, "..", "..", "..");

/** The migrations in supabase/migrations, in order. */
export function migrations(): string[] {
  const dir = join(REPO, "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

/** supabase/setup.sql: the file people paste in Supabase's SQL Editor (`pnpm db:setup`). */
export function setupSql(): string {
  return readFileSync(join(REPO, "supabase", "setup.sql"), "utf8");
}

/** A fresh Postgres (PGlite) with what Supabase provides and the database of supabase/setup.sql. */
export async function testDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, "supabase-shim.sql"), "utf8"));
  await db.exec(setupSql());
  return db;
}

/** An account as Supabase Auth creates it (the trigger makes its profile). */
export async function createUser(db: PGlite, email: string, meta: Record<string, string> = {}): Promise<string> {
  const r = await db.query<{ id: string }>("insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), $2) returning id", [email, JSON.stringify(meta)]);
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("no user");
  return id;
}
