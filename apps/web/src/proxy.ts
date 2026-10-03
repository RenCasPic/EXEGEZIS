import { cloudConfig, currentMode, safeNext } from "@exegezis/accounts";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE } from "./i18n/locales";

/*
 * Before every request:
 * - `?lang=en|es` (links from the landing) sets the language cookie;
 * - the requested path goes to the page as x-exegezis-path, to come back to
 *   it after signing in;
 * - cloud mode: the Supabase session is refreshed (its cookies rewritten) and
 *   a visitor without a session is sent to /login?next=… (API routes answer
 *   401). This is the optimistic check: every page, action and route checks
 *   the user again on the server (requireUser / currentWorkspace).
 */

/** Pages and routes anyone may open in cloud mode. */
const PUBLIC = [/^\/login\/?$/, /^\/signup\/?$/, /^\/forgot-password\/?$/, /^\/verify-email\/?$/, /^\/auth\//, /^\/api\/session\/?$/, /^\/api\/health\/?$/];
/** Pages a signed-in user has no reason to see: back to the app. */
const SIGNED_OUT_ONLY = [/^\/login\/?$/, /^\/signup\/?$/, /^\/forgot-password\/?$/];

function withLanguage(request: NextRequest, response: NextResponse): NextResponse {
  const lang = request.nextUrl.searchParams.get("lang");
  if (isLocale(lang)) response.cookies.set(LOCALE_COOKIE, lang, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  const headers = new Headers(request.headers);
  headers.set("x-exegezis-path", `${path}${request.nextUrl.search}`);
  if (currentMode() !== "cloud") return withLanguage(request, NextResponse.next({ request: { headers } }));

  const c = cloudConfig();
  if (!c.ok) return new NextResponse(`EXEGEZIS_MODE=cloud needs ${c.missing.join(", ")} (see .env.example).`, { status: 500 });
  const config = c.config;
  const cookieOptions = (options: CookieOptions = {}): CookieOptions => ({
    ...options,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: config.appUrl.startsWith("https://"),
    ...(config.cookieDomain === null ? {} : { domain: config.cookieDomain }),
  });

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
  const signedIn = data.user !== null;

  const redirectTo = (target: string) => {
    const r = NextResponse.redirect(new URL(target, request.url));
    for (const cookie of response.cookies.getAll()) r.cookies.set(cookie);
    return withLanguage(request, r);
  };

  if (!signedIn && !PUBLIC.some((p) => p.test(path))) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return redirectTo(`/login?next=${encodeURIComponent(safeNext(`${path}${request.nextUrl.search}`))}`);
  }
  if (signedIn && SIGNED_OUT_ONLY.some((p) => p.test(path))) return redirectTo(safeNext(request.nextUrl.searchParams.get("next")));
  return withLanguage(request, response);
}

export const config = {
  // Everything but Next's static files and the icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
