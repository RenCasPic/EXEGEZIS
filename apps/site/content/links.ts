/*
 * Where the site's buttons go. Until the cloud version exists, they open the
 * local app (or a mailto for sales). Each one can be changed at build time
 * with its NEXT_PUBLIC_EXEGEZIS_* variable.
 */

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
};

/** The local app (apps/web). «Inspect for free» opens it with the address filled in. */
export const LOCAL_APP_URL = (env("NEXT_PUBLIC_EXEGEZIS_APP_URL") ?? "http://127.0.0.1:4100").replace(/\/+$/, "");

export const LINKS = {
  signIn: env("NEXT_PUBLIC_EXEGEZIS_SIGN_IN_URL") ?? `${LOCAL_APP_URL}/`,
  start: env("NEXT_PUBLIC_EXEGEZIS_START_URL") ?? `${LOCAL_APP_URL}/`,
  tryPro: env("NEXT_PUBLIC_EXEGEZIS_TRY_PRO_URL") ?? `${LOCAL_APP_URL}/`,
  startTeam: env("NEXT_PUBLIC_EXEGEZIS_TEAM_URL") ?? `${LOCAL_APP_URL}/`,
  // TODO: a real sales address. `.example` is a reserved domain: nothing is sent anywhere until it is set.
  sales: env("NEXT_PUBLIC_EXEGEZIS_SALES_URL") ?? "mailto:sales@exegezis.example",
} as const;

/** The local app's Inspect tab with the site's address already filled in. */
export function inspectUrl(site: string): string {
  return `${LOCAL_APP_URL}/?url=${encodeURIComponent(site)}`;
}
