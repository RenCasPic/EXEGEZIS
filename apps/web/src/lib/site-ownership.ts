import { resolveTxt } from "node:dns/promises";
import { assertPublicTarget, sharedServer } from "./plan-gate";

/*
 * Proof that a site is the user's (Settings → Sites), as Google Search
 * Console does it, with the token of that site:
 * - a meta tag on its home page:
 *     <meta name="exegezis-site-verification" content="TOKEN">
 * - or a DNS TXT record on the domain:
 *     exegezis-site-verification=TOKEN
 * Checked by the server; on a shared server it never follows a redirect to a
 * private address.
 */

export const VERIFICATION_NAME = "exegezis-site-verification";

/** The registrable domain of a host (example.com for www.example.com). */
function baseDomain(host: string): string {
  const labels = host.split(".");
  const take = labels.length >= 3 && (labels.at(-1) ?? "").length === 2 && ["co", "com", "net", "org", "gob", "gov", "edu"].includes(labels.at(-2) ?? "") ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Does the HTML carry the meta tag with this token (any attribute order, any quotes)? */
export function hasVerificationMeta(html: string, token: string): boolean {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
    const n = attr("name");
    const c = attr("content");
    if ((n?.[1] ?? n?.[2] ?? n?.[3] ?? "").toLowerCase() === VERIFICATION_NAME && (c?.[1] ?? c?.[2] ?? c?.[3] ?? "").trim() === token) return true;
  }
  return false;
}

async function fetchHome(url: string): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (sharedServer()) {
      try {
        await assertPublicTarget(current);
      } catch {
        return null;
      }
    }
    const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "EXEGEZIS-SiteVerification" } }).catch(() => null);
    if (res === null) return null;
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next !== null) {
      current = new URL(next, current).toString();
      continue;
    }
    if (!res.ok) return null;
    return (await res.text()).slice(0, 1024 * 1024);
  }
  return null;
}

/** How the site proves it is the user's, or null if it does not (yet). */
export async function checkOwnership(site: string, token: string): Promise<"meta" | "dns" | null> {
  for (const host of [...new Set([site, baseDomain(site)])]) {
    try {
      const records = await resolveTxt(host);
      if (records.some((parts) => parts.join("").trim() === `${VERIFICATION_NAME}=${token}`)) return "dns";
    } catch {
      // no TXT records
    }
  }
  for (const url of [`https://${site}/`, `https://www.${site}/`, `http://${site}/`]) {
    const html = await fetchHome(url);
    if (html !== null && hasVerificationMeta(html, token)) return "meta";
  }
  return null;
}
