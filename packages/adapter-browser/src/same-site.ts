/*
 * Whether two hosts belong to the same site (registrable domain), so that
 * www.example.com, example.com and api.example.com are the page's own
 * requests while googlesyndication.com or a chat widget's domain are not.
 * Without a public-suffix list: the last two labels, or three when the
 * second-level label is a common registry one (co.uk, com.mx, com.br…).
 * Hosts that are IP addresses or single labels (localhost) are compared as is.
 */

const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "gob", "mil", "nic", "or", "ne", "go"]);

export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "" || /^[\d.]+$/.test(h) || h.includes(":") || !h.includes(".")) return h;
  const labels = h.split(".");
  const take = labels.length >= 3 && (labels.at(-1) ?? "").length === 2 && SECOND_LEVEL.has(labels.at(-2) ?? "") ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function sameSite(a: string, b: string): boolean {
  return a !== "" && b !== "" && siteOf(a) === siteOf(b);
}
