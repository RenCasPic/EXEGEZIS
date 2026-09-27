import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, resolveLocale } from "./locales";
import { loadMessages } from "./messages";

/** next-intl without locale routing: the language comes from the cookie, else from the browser. */
export default getRequestConfig(async () => {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(jar.get(LOCALE_COOKIE)?.value, head.get("accept-language"));
  return { locale, messages: loadMessages(locale), timeZone: "UTC" };
});
