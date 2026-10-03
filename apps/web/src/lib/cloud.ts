import { cloudConfig, connect, currentMode, safeNext, type CloudConfig, type Sql } from "@exegezis/accounts";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

/*
 * Cloud mode (EXEGEZIS_MODE=cloud, docs/13-accounts.md): Supabase Auth for
 * accounts and sessions, Postgres with Row Level Security for each user's
 * data. In local mode (the default) none of this runs.
 */

export function isCloud(): boolean {
  return currentMode() === "cloud";
}

/** The cloud settings; a clear error listing what is missing otherwise. */
export function cloud(): CloudConfig {
  const c = cloudConfig();
  if (!c.ok) throw new Error(`EXEGEZIS_MODE=cloud needs ${c.missing.join(", ")} (see .env.example and docs/13-accounts.md).`);
  return c.config;
}

const globalDb = globalThis as unknown as { __exegezisDb?: Sql };

/** One pool per server process (kept across hot reloads in development). */
export function db(): Sql {
  globalDb.__exegezisDb ??= connect(cloud().databaseUrl);
  return globalDb.__exegezisDb;
}

/**
 * The session cookies: httpOnly (only the server reads them: there is no
 * Supabase client in the browser), SameSite=Lax, Secure on https, and shared
 * with subdomains only when EXEGEZIS_COOKIE_DOMAIN is set.
 */
export function sessionCookieOptions(options: CookieOptions = {}): CookieOptions {
  const c = cloud();
  return {
    ...options,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: c.appUrl.startsWith("https://"),
    ...(c.cookieDomain === null ? {} : { domain: c.cookieDomain }),
  };
}

/** Supabase Auth for this request (server components, server actions, route handlers). */
export async function supabase() {
  const c = cloud();
  const store = await cookies();
  return createServerClient(c.supabaseUrl, c.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, sessionCookieOptions(options));
        } catch {
          // A server component cannot set cookies; the proxy refreshes the session instead.
        }
      },
    },
    cookieOptions: sessionCookieOptions(),
  });
}

export interface SignedInUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /** Sign-in methods linked to the account: email, google, github. */
  providers: string[];
  user: User;
}

function toSignedIn(user: User): SignedInUser {
  const meta = user.user_metadata as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id: user.id,
    email: user.email ?? "",
    name: text(meta["name"]) || text(meta["full_name"]) || text(meta["user_name"]) || (user.email ?? "").split("@")[0] || "",
    avatarUrl: text(meta["avatar_url"]) || null,
    providers: [...new Set((user.identities ?? []).map((i) => i.provider))],
    user,
  };
}

/** The signed-in user (checked with Supabase Auth, once per request), or null. Always null in local mode. */
export const getUser = cache(async (): Promise<SignedInUser | null> => {
  if (!isCloud()) return null;
  const { data, error } = await (await supabase()).auth.getUser();
  if (error !== null || data.user === null) return null;
  return toSignedIn(data.user);
});

/** The page being asked for (set by the proxy), to come back to it after signing in. */
async function currentPath(): Promise<string> {
  const h = await headers();
  return safeNext(h.get("x-exegezis-path"), "/");
}

/** The signed-in user; otherwise, to /login (and back here afterwards). Only meaningful in cloud mode. */
export async function requireUser(): Promise<SignedInUser> {
  const user = await getUser();
  if (user === null) redirect(`/login?next=${encodeURIComponent(await currentPath())}`);
  return user;
}
