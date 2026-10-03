import { notFound } from "next/navigation";

/**
 * Any URL that matches no page: the app's 404 ((app)/not-found.tsx), inside
 * its shell and in the reader's language. The app and the public pages have
 * separate root layouts, so there is no single root to hold it; the public
 * pages and `/` are matched first (static routes win over this catch-all).
 */
export default function Missing() {
  notFound();
}
