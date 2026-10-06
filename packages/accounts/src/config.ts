/*
 * What the app needs to run (docs/13-accounts.md): a Supabase project for
 * accounts, sessions and each user's data, reached with its URL and API keys
 * (Project Settings → API), as in any Supabase app. No database password.
 * Like any web app, it always has accounts: the landing first, sign-in, then
 * the app. (The CLI works without any of this.)
 */

export interface AppConfig {
  /** The project's URL (NEXT_PUBLIC_SUPABASE_URL), e.g. https://xyz.supabase.co. */
  supabaseUrl: string;
  /** The public «anon» key (NEXT_PUBLIC_SUPABASE_ANON_KEY): with each user's session, Row Level Security applies. */
  supabaseAnonKey: string;
  /** SECRET. The «service_role» key (SUPABASE_SERVICE_ROLE_KEY): server only, for the operator's tasks. */
  supabaseServiceRoleKey: string;
  /** Where the app is published (EXEGEZIS_APP_URL, default http://127.0.0.1:4100): links in emails and OAuth redirects. */
  appUrl: string;
  /** OAuth providers with keys configured in Supabase (EXEGEZIS_OAUTH_PROVIDERS=google,github). */
  oauthProviders: ("google" | "github")[];
  /** Folder with one sub-folder per user for heavy artifacts (EXEGEZIS_DATA_DIR). */
  dataDir: string | null;
}

export const DEFAULT_APP_URL = "http://127.0.0.1:4100";

const PROVIDERS = ["google", "github"] as const;

/** The first of `names` that is set (the first one is the name to ask for). */
function value(env: NodeJS.ProcessEnv, names: readonly string[]): string {
  for (const n of names) {
    const v = (env[n] ?? "").trim();
    if (v !== "") return v;
  }
  return "";
}

/** The variables and their older names (still read, so an older .env keeps working). */
export const CONFIG_VARIABLES = {
  supabaseUrl: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"],
  supabaseAnonKey: ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"],
  supabaseServiceRoleKey: ["SUPABASE_SERVICE_ROLE_KEY"],
} as const;

/** The app's settings, or the list of missing variables. */
export function appConfig(env: NodeJS.ProcessEnv = process.env): { ok: true; config: AppConfig } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const need = (names: readonly string[]) => {
    const v = value(env, names);
    if (v === "") missing.push(names[0] ?? "");
    return v;
  };
  const supabaseUrl = need(CONFIG_VARIABLES.supabaseUrl).replace(/\/+$/, "");
  const supabaseAnonKey = need(CONFIG_VARIABLES.supabaseAnonKey);
  const supabaseServiceRoleKey = need(CONFIG_VARIABLES.supabaseServiceRoleKey);
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
      supabaseServiceRoleKey,
      appUrl: (value(env, ["EXEGEZIS_APP_URL"]) || DEFAULT_APP_URL).replace(/\/+$/, ""),
      oauthProviders: [...new Set(providers)],
      dataDir: dataDir === "" ? null : dataDir,
    },
  };
}
