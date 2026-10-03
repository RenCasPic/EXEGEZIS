/*
 * How EXEGEZIS runs (EXEGEZIS_MODE):
 * - local (default): one person, no sign-in, only on 127.0.0.1, data in runs/.
 * - cloud: accounts (Supabase Auth), sign-in required, data per user.
 */

export type Mode = "local" | "cloud";

export function modeFrom(value: string | undefined): Mode {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "" || v === "local") return "local";
  if (v === "cloud") return "cloud";
  throw new Error(`EXEGEZIS_MODE must be "local" or "cloud" (it is "${value ?? ""}").`);
}

export function currentMode(env: NodeJS.ProcessEnv = process.env): Mode {
  return modeFrom(env["EXEGEZIS_MODE"]);
}

export interface CloudConfig {
  /** Supabase project URL (SUPABASE_URL), e.g. https://xyz.supabase.co or http://127.0.0.1:54321. */
  supabaseUrl: string;
  /** The public anon key (SUPABASE_ANON_KEY). */
  supabaseAnonKey: string;
  /** Postgres connection (DATABASE_URL): the app impersonates each user so Row Level Security applies. */
  databaseUrl: string;
  /** Where the app is published (EXEGEZIS_APP_URL): links in emails and OAuth redirects. */
  appUrl: string;
  /** Where the landing is published (EXEGEZIS_SITE_URL): «See plans», help, legal pages. */
  siteUrl: string;
  /** OAuth providers with keys configured in Supabase (EXEGEZIS_OAUTH_PROVIDERS=google,github). */
  oauthProviders: ("google" | "github")[];
  /** Cookie domain to share the session between subdomains (EXEGEZIS_COOKIE_DOMAIN=.exegezis.com); empty: this host only. */
  cookieDomain: string | null;
  /** Folder with one sub-folder per user for heavy artifacts (EXEGEZIS_DATA_DIR). */
  dataDir: string | null;
}

const PROVIDERS = ["google", "github"] as const;

function required(env: NodeJS.ProcessEnv, name: string, problems: string[]): string {
  const v = (env[name] ?? "").trim();
  if (v === "") problems.push(name);
  return v;
}

/** The cloud settings, or the list of missing variables. */
export function cloudConfig(env: NodeJS.ProcessEnv = process.env): { ok: true; config: CloudConfig } | { ok: false; missing: string[] } {
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
  const domain = (env["EXEGEZIS_COOKIE_DOMAIN"] ?? "").trim();
  const dataDir = (env["EXEGEZIS_DATA_DIR"] ?? "").trim();
  return {
    ok: true,
    config: {
      supabaseUrl,
      supabaseAnonKey,
      databaseUrl,
      appUrl,
      siteUrl: (env["EXEGEZIS_SITE_URL"] ?? "").trim().replace(/\/+$/, "") || "http://127.0.0.1:4200",
      oauthProviders: [...new Set(providers)],
      cookieDomain: domain === "" ? null : domain,
      dataDir: dataDir === "" ? null : dataDir,
    },
  };
}
