/*
 * Where the site's buttons go. Each one can be changed at build time with its
 * NEXT_PUBLIC_EXEGEZIS_* variable.
 *
 * - Local mode (NEXT_PUBLIC_EXEGEZIS_MODE unset or "local"): the app runs on
 *   the visitor's computer, without accounts: the buttons open it.
 * - Cloud mode ("cloud"): «Sign in» → the app's /login, «Start for free» and
 *   «Try…» → /signup with the chosen plan, «Inspect for free» → /signup and,
 *   after it, the app with the address filled in (signed-in visitors go
 *   straight there: the app skips /signup for them).
 *
 * Next.js only inlines public variables written literally as
 * `process.env.NEXT_PUBLIC_…`, so each one is read by name here.
 */

const set = (value: string | undefined): string | undefined => (value === undefined || value.trim() === "" ? undefined : value.trim());

export const CLOUD = set(process.env.NEXT_PUBLIC_EXEGEZIS_MODE)?.toLowerCase() === "cloud";

/** The app (apps/web): local, or the cloud one (e.g. https://app.exegezis.com). */
export const LOCAL_APP_URL = (set(process.env.NEXT_PUBLIC_EXEGEZIS_APP_URL) ?? "http://127.0.0.1:4100").replace(/\/+$/, "");

/** Contact for privacy matters (the privacy policy shows it). TODO: the real address; `.example` is a reserved domain. */
export const PRIVACY_EMAIL = set(process.env.NEXT_PUBLIC_EXEGEZIS_PRIVACY_EMAIL) ?? "privacy@exegezis.example";

type Locale = "en" | "es";

function app(path: string, locale: Locale, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ ...params, lang: locale });
  return `${LOCAL_APP_URL}${path}?${query.toString()}`;
}

/** The buttons' targets in a language (the app opens in the same one). */
export function linksFor(locale: Locale) {
  return {
    signIn: set(process.env.NEXT_PUBLIC_EXEGEZIS_SIGN_IN_URL) ?? (CLOUD ? app("/login", locale) : `${LOCAL_APP_URL}/`),
    start: set(process.env.NEXT_PUBLIC_EXEGEZIS_START_URL) ?? (CLOUD ? app("/signup", locale, { plan: "free" }) : `${LOCAL_APP_URL}/`),
    tryPro: set(process.env.NEXT_PUBLIC_EXEGEZIS_TRY_PRO_URL) ?? (CLOUD ? app("/signup", locale, { plan: "pro" }) : `${LOCAL_APP_URL}/`),
    startTeam: set(process.env.NEXT_PUBLIC_EXEGEZIS_TEAM_URL) ?? (CLOUD ? app("/signup", locale, { plan: "team" }) : `${LOCAL_APP_URL}/`),
    // TODO: a real sales address. `.example` is a reserved domain: nothing is sent anywhere until it is set.
    sales: set(process.env.NEXT_PUBLIC_EXEGEZIS_SALES_URL) ?? "mailto:sales@exegezis.example",
    /** The app itself, for a signed-in visitor («Go to the app»). */
    app: app("/", locale),
  } as const;
}

/**
 * «Inspect for free» with an address: the app's Inspect tab with it filled in.
 * Cloud mode goes through /signup (a signed-in visitor is sent on to the app).
 */
export function inspectUrl(site: string, locale: Locale = "en"): string {
  const target = `/?url=${encodeURIComponent(site)}`;
  return CLOUD ? app("/signup", locale, { plan: "free", next: target }) : `${LOCAL_APP_URL}${target}`;
}
