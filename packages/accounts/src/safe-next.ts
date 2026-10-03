/**
 * Where to go after signing in (`?next=`): only a path of this app. Anything
 * else (another site, `//host`, `/\host`, a scheme, control characters) gives
 * the fallback, so the parameter cannot send anyone elsewhere.
 */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    const base = "http://exegezis.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
