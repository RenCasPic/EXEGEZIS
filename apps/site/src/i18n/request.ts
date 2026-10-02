import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale } from "./locales";
import { CATALOGS } from "./messages";

/** next-intl with the language in the URL ([locale] segment): every page is static. */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
  return {
    locale,
    messages: CATALOGS[locale],
    timeZone: "UTC",
    // A missing text is visible (and caught by the end-to-end test), never silently a key path.
    getMessageFallback: ({ namespace, key }) => `⟦${namespace === undefined ? key : `${namespace}.${key}`}⟧`,
  };
});
