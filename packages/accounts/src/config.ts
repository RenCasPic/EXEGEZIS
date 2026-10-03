/*
 * What the app needs to run (docs/13-accounts.md): Supabase for accounts and
 * sessions, Postgres for each user's data. Like any web app, it always has
 * accounts: the landing first, sign-in, then the app. (The CLI works without
 * any of this.)
 */

export interface AppConfig {
  /** Supabase project URL (SUPABASE_URL), e.g. https://xyz.supabase.co or http://127.0.0.1:54321. */
  supabaseUrl: string;
  /** The public anon key (SUPABASE_ANON_KEY). */
  supabaseAnonKey: string;
  /** Postgres connection (DATABASE_URL): the app impersonates each user so Row Level Security applies. */
  databaseUrl: string;
  /** Where the app is published (EXEGEZIS_APP_URL): links in emails and OAuth redirects. The public pages, sign-in and the app share it (one domain). */
  appUrl: string;
  /** OAuth providers with keys configured in Supabase (EXEGEZIS_OAUTH_PROVIDERS=google,github). */
  oauthProviders: ("google" | "github")[];
  /** Folder with one sub-folder per user for heavy artifacts (EXEGEZIS_DATA_DIR). */
  dataDir: string | null;
}

const PROVIDERS = ["google", "github"] as const;

function required(env: NodeJS.ProcessEnv, name: string, problems: string[]): string {
  const v = (env[name] ?? "").trim();
  if (v === "") problems.push(name);
  return v;
}

/** The app's settings, or the list of missing variables. */
export function appConfig(env: NodeJS.ProcessEnv = process.env): { ok: true; config: AppConfig } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const supabaseUrl = required(env, "SUPABASE_URL", missing).replace(/\/+$/, "");
  const supabaseAnonKey = required(env, "SUPABASE_ANON_KEY", missing);
  const databaseUrl = required(env, "DATABASE_URL", missing);
  const appUrl = required(env, "EXEGEZIS_APP_URL", missing).replace(/\/+$/, "");
  if (missing.length > 0) return { ok: false, missing };
  const providers = (env["EXEGEZIS_OAUTH_PROVIDERS"] ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is (typeof PROVIDERS)[number] => (PROVIDERS as readonly string[]).includes(p));
  const dataDir = (env["EXEGEZIS_DATA_DIR"] ?? "").trim();
  return {
    ok: true,
    config: {
      supabaseUrl,
      supabaseAnonKey,
      databaseUrl,
      appUrl,
      oauthProviders: [...new Set(providers)],
      dataDir: dataDir === "" ? null : dataDir,
    },
  };
}
