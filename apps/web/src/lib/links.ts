import { cloud, isCloud } from "./cloud";

/*
 * Links from the app to the landing (apps/site): plans, help and the legal
 * pages. The landing's address is EXEGEZIS_SITE_URL (cloud mode) or the local
 * one (http://127.0.0.1:4200).
 */

export function siteUrl(): string {
  if (isCloud()) return cloud().siteUrl;
  return (process.env["EXEGEZIS_SITE_URL"] ?? "").trim().replace(/\/+$/, "") || "http://127.0.0.1:4200";
}

export function siteLinks(locale: "en" | "es") {
  const base = `${siteUrl()}/${locale}`;
  return {
    plans: `${base}/#pricing`,
    help: `${base}/#faq`,
    terms: `${base}/${locale === "es" ? "terminos" : "terms"}/`,
    privacy: `${base}/${locale === "es" ? "privacidad" : "privacy"}/`,
  };
}
