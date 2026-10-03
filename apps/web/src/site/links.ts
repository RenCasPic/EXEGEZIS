import { currentMode } from "@exegezis/accounts";
import type { SiteLocale } from "./i18n";

export { inspectUrl, SIGNED_IN_HINT_COOKIE } from "./urls";

/*
 * Where the public pages' buttons go. Everything is on the same domain as the
 * app (one server, one session):
 * - cloud mode: «Sign in» → /login, «Start for free» and «Try…» → /signup
 *   with the plan, «Inspect for free» → /signup, then the app with the
 *   address filled in (a signed-in visitor is sent straight there);
 * - local mode: there are no accounts: the buttons open the app (/).
 * Read on the server (the mode is EXEGEZIS_MODE); client components get the
 * result as props.
 */

export interface SiteLinks {
  cloud: boolean;
  signIn: string;
  start: string;
  tryPro: string;
  startTeam: string;
  sales: string;
  /** The app itself («Go to the app»). */
  app: string;
}

const value = (name: string): string | undefined => {
  const v = (process.env[name] ?? "").trim();
  return v === "" ? undefined : v;
};

/** Contact for privacy matters (the privacy policy shows it). TODO: the real address; `.example` is a reserved domain. */
export function privacyEmail(): string {
  return value("EXEGEZIS_PRIVACY_EMAIL") ?? "privacy@exegezis.example";
}

export function siteLinks(locale: SiteLocale): SiteLinks {
  // TODO: a real sales address. `.example` is a reserved domain: nothing is sent anywhere until it is set.
  const sales = value("EXEGEZIS_SALES_URL") ?? "mailto:sales@exegezis.example";
  if (currentMode() !== "cloud") return { cloud: false, signIn: "/", start: "/", tryPro: "/", startTeam: "/", sales, app: "/" };
  const signup = (plan: string) => `/signup?${new URLSearchParams({ plan, lang: locale }).toString()}`;
  return { cloud: true, signIn: `/login?lang=${locale}`, start: signup("free"), tryPro: signup("pro"), startTeam: signup("team"), sales, app: "/" };
}
