import { cloudConfig, currentMode, safeNext } from "@exegezis/accounts";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE, resolveLocale } from "./i18n/locales";
import { SITE_PATHS } from "./site/paths";
import { SIGNED_IN_HINT_COOKIE } from "./site/urls";

/*
 * Before every request of the app (the public pages — /producto, /product,
 * /privacidad, /terminos, /privacy, /terms — never come through here: they
 * are static, see `config.matcher`):
 * - `?lang=en|es` (links from the public pages) sets the language cookie;
 * - the requested path goes to the page as x-exegezis-path, to come back to
 *   it after signing in;
 * - cloud mode: `/` without a session shows the landing (same URL; no call to
 *   Supabase when there is no session cookie at all); otherwise the Supabase
 *   session is refreshed and a visitor without one is sent to /login?next=…
 *   (API routes answer 401). This is the optimistic check: every page, action
 *   and route checks the user again on the server.
 */

/** Pages and routes anyone may open in cloud mode. */
const PUBLIC = [/^\/login\/?$/, /^\/signup\/?$/, /^\/forgot-password\/?$/, /^\/verify-email\/?$/, /^\/auth\//, /^\/api\/health\/?$/];
/** Pages a signed-in user has no reason to see: back to the app. */
const SIGNED_OUT_ONLY = [/^\/login\/?$/, /^\/signup\/?$/, /^\/forgot-password\/?$/];

function withLanguage(request: NextRequest, response: NextResponse): NextResponse {
  const lang = request.nextUrl.searchParams.get("lang");
  if (isLocale(lang)) response.cookies.set(LOCALE_COOKIE, lang, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return response;
}

/** Supabase's session cookies (sb-<ref>-auth-token, possibly in chunks), not the PKCE verifier. */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith("sb-") && /-auth-token(\.\d+)?$/.test(c.name));
}

/** `/` for a visitor without a session: the landing, in their language (cookie, else the browser's). */
function landing(request: NextRequest): NextResponse {
  const locale = resolveLocale(request.cookies.get(LOCALE_COOKIE)?.value, request.headers.get("accept-language"));
  const response = NextResponse.rewrite(new URL(SITE_PATHS.landing[locale], request.url));
  if (request.cookies.has(SIGNED_IN_HINT_COOKIE)) response.cookies.delete(SIGNED_IN_HINT_COOKIE);
  return withLanguage(request, response);
}

function initials(user: User): string {
  const meta = user.user_metadata as Record<string, unknown>;
  const name = [meta["name"], meta["full_name"], meta["user_name"], user.email].find((v): v is string => typeof v === "string" && v !== "") ?? "";
  const words = name.split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "·";
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  const headers = new Headers(request.headers);
  headers.set("x-exegezis-path", `${path}${request.nextUrl.search}`);
  if (currentMode() !== "cloud") return withLanguage(request, NextResponse.next({ request: { headers } }));

  const c = cloudConfig();
  if (!c.ok) return new NextResponse(`EXEGEZIS_MODE=cloud needs ${c.missing.join(", ")} (see .env.cloud.example).`, { status: 500 });
  const config = c.config;

  // `/` without any session cookie: the landing, without asking Supabase.
  if (path === "/" && !hasSessionCookie(request)) {
    const url = request.nextUrl.searchParams.get("url");
    // A link to the Inspect tab with an address: sign up first, then there.
    if (url !== null) return withLanguage(request, NextResponse.redirect(new URL(`/signup?${new URLSearchParams({ plan: "free", next: `/?url=${url}` }).toString()}`, request.url)));
    return landing(request);
  }

  const cookieOptions = (options: CookieOptions = {}): CookieOptions => ({ ...options, path: "/", httpOnly: true, sameSite: "lax", secure: config.appUrl.startsWith("https://") });
  let response = NextResponse.next({ request: { headers } });
  const supabase = createServerClient(config.supabaseUrl, config.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        headers.set("cookie", request.cookies.toString());
        response = NextResponse.next({ request: { headers } });
        for (const { name, value, options } of list) response.cookies.set(name, value, cookieOptions(options));
      },
    },
    cookieOptions: cookieOptions(),
  });
  // Validates the session with Supabase Auth and refreshes it when needed.
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  const carry = (r: NextResponse) => {
    for (const cookie of response.cookies.getAll()) r.cookies.set(cookie);
    return withLanguage(request, r);
  };

  if (user === null) {
    if (path === "/") return carry(landing(request));
    if (!PUBLIC.some((p) => p.test(path))) {
      if (path.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      const r = carry(NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(safeNext(`${path}${request.nextUrl.search}`))}`, request.url)));
      if (request.cookies.has(SIGNED_IN_HINT_COOKIE)) r.cookies.delete(SIGNED_IN_HINT_COOKIE);
      return r;
    }
    if (request.cookies.has(SIGNED_IN_HINT_COOKIE)) response.cookies.delete(SIGNED_IN_HINT_COOKIE);
    return withLanguage(request, response);
  }

  // Signed in: the hint the public pages read (the initials only; not the session, which stays httpOnly).
  const hint = encodeURIComponent(initials(user));
  if (request.cookies.get(SIGNED_IN_HINT_COOKIE)?.value !== hint) response.cookies.set(SIGNED_IN_HINT_COOKIE, hint, { path: "/", sameSite: "lax", secure: config.appUrl.startsWith("https://"), maxAge: 60 * 60 * 24 * 30 });
  if (SIGNED_OUT_ONLY.some((p) => p.test(path))) return carry(NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url)));
  return withLanguage(request, response);
}

export const config = {
  // Everything but Next's files, the icons and images, and the static public pages.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|og-en\\.png|og-es\\.png|producto/?$|product/?$|privacidad/?$|terminos/?$|privacy/?$|terms/?$).*)"],
};
