import en from "../../messages/en.json";
import es from "../../messages/es.json";
import type { Locale } from "./locales";

/** The catalogs of the site (messages/{en,es}.json): the same keys in both, checked by test/site.test.ts. */
export const CATALOGS: Record<Locale, typeof en> = { en, es };
