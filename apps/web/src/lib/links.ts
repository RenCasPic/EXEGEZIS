import { SITE_PATHS } from "@/site/paths";

/*
 * Links from the app to its public pages (same domain): plans, help and the
 * legal texts, in the reader's language.
 */
export function siteLinks(locale: "en" | "es") {
  const landing = SITE_PATHS.landing[locale];
  return {
    landing,
    plans: `${landing}#pricing`,
    help: `${landing}#faq`,
    terms: SITE_PATHS.terms[locale],
    privacy: SITE_PATHS.privacy[locale],
  };
}
