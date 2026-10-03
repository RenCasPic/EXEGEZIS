import type { SiteLocale } from "./i18n";

/* What the public pages' client components need: no server imports here. */

/** «Inspect for free» with an address: sign up, then the app's Inspect tab with it filled in (a signed-in visitor goes straight there). */
export function inspectUrl(site: string, locale: SiteLocale): string {
  const target = `/?url=${encodeURIComponent(site)}`;
  return `/signup?${new URLSearchParams({ plan: "free", next: target, lang: locale }).toString()}`;
}

/** A hint the app leaves for the public pages (not a secret, not the session): «signed in», and the initials to show. */
export const SIGNED_IN_HINT_COOKIE = "EXEGEZIS_SIGNED_IN";
