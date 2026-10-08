/*
 * Which addresses an inspection may request (docs/07-web-inspection.md §4,
 * «Política de enlaces»). Safe by design rather than by a list of names: an
 * address is never requested — not visited, not checked with HEAD or GET —
 * when anything in it looks like an action rather than a page:
 *   - a technical route (/api/, /ajax/, /admin/, /wp-admin/, /wp-json/, /graphql…);
 *   - an action word anywhere in the path or the query, whole, glued to the
 *     next word (deleteAccount, removeitem, log_out) or with hyphens;
 *   - a parameter that names an action or carries a one-time token
 *     (action=, do=, cmd=, op=, method=, _wpnonce=, nonce=, csrf…);
 *   - a link whose text is an action («Log out», «Delete», «Darse de baja»).
 * Missing a page is the price of never pressing a button by accident.
 */

/** Routes that are interfaces or back offices, not pages for visitors. */
const TECHNICAL_ROUTE = /(^|\/)(api|apis|ajax|admin|administrator|wp-admin|wp-json|wp-login\.php|xmlrpc\.php|graphql|gql|rest|rpc|json-rpc|cgi-bin|backend|_next\/data|webhooks?|callback|oauth|auth\/callback)(\/|$|\?|\.)/i;

/**
 * Words that do something. A word of the address that IS one of these, or
 * STARTS with one of the strong ones (deleteaccount, logoutall), makes it an
 * action.
 */
const STRONG = ["delete", "remove", "destroy", "erase", "purge", "wipe", "truncate", "logout", "logoff", "signout", "unsubscribe", "unregister", "deactivate", "revoke", "terminate", "borrar", "eliminar", "cerrarsesion", "darsedebaja"];
const WEAK = [
  "cancel", "confirm", "reset", "clear", "empty", "kill", "ban", "block", "unblock", "approve", "reject", "accept", "decline", "verify", "activate", "disable", "enable", "archive", "restore", "toggle",
  "update", "save", "submit", "send", "publish", "upload", "import", "pay", "refund", "checkout", "buy", "purchase", "vote", "like", "unlike", "follow", "unfollow", "subscribe", "rate", "flag", "report", "share",
  "salir", "cancelar", "confirmar", "anular", "comprar", "pagar",
];
const STRONG_SET = new Set(STRONG);
/** The ones also caught at the start of a longer word (deleteaccount, removeitem, logoutall): unmistakable English verbs only. */
const PREFIXES = ["delete", "remove", "destroy", "logout", "signout", "unsubscribe", "deactivate", "revoke", "purge"];
const WEAK_SET = new Set(WEAK);
/** «add» acts when it goes with a cart, a basket, a wishlist… (add-to-cart, addToBasket). */
const ADD_TARGETS = new Set(["cart", "basket", "bag", "wishlist", "favorite", "favourite", "favorites", "compare", "item", "product", "carrito", "cesta"]);

/** Parameters that name an action or carry a one-time token. */
const ACTION_PARAM = /^(action|do|cmd|command|op|operation|method|task|act|_method|_action|_wpnonce|wpnonce|nonce|csrf|csrf_token|_token|authenticity_token|token|confirm|delete|remove|logout)$/i;

/** The words of a piece of address: split on punctuation and camelCase, lower case. */
export function addressWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9áéíóúñÁÉÍÓÚÑ]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w !== "");
}

/** Why requesting this address could act on the site, or null when it is a page. */
export function actionReason(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "not a valid address";
  }
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep it encoded
  }
  const route = TECHNICAL_ROUTE.exec(path);
  if (route !== null) return `technical route (/${(route[2] ?? "").toLowerCase()}/), not a page`;
  for (const key of u.searchParams.keys()) if (ACTION_PARAM.test(key)) return `the parameter «${key}» names an action or carries a one-time token`;
  const pieces = [path, ...[...u.searchParams.entries()].flatMap(([k, v]) => [k, v])];
  // Glued all-lowercase words (deleteaccount) are caught by their start; hyphenated and camelCase ones by their words.
  const raw = pieces.flatMap((p) => p.toLowerCase().split(/[^a-z0-9áéíóúñ]+/)).filter((w) => w !== "");
  const words = pieces.flatMap(addressWords);
  // Two or three words that make one action when joined: log-out, sign_out, cerrar-sesion, darse-de-baja.
  const joined = pieces.flatMap((p) => {
    const ws = addressWords(p);
    return ws.flatMap((w, i) => [w + (ws[i + 1] ?? ""), w + (ws[i + 1] ?? "") + (ws[i + 2] ?? "")]);
  });
  for (const w of [...words, ...raw, ...joined]) {
    if (STRONG_SET.has(w)) return `the address says «${w}»: an action, not a page`;
    const strong = PREFIXES.find((s) => w.startsWith(s));
    if (strong !== undefined) return `the address says «${w}» (${strong}…): an action, not a page`;
  }
  // The weaker words only in a short piece (/cart/save, /confirm-email, ?step=checkout), not in an
  // article's title (/blog/how-to-save-money).
  const shortPieces = [...path.split("/"), ...[...u.searchParams.entries()].flatMap(([k, v]) => [k, v])].map(addressWords).filter((ws) => ws.length > 0 && ws.length <= 2);
  for (const ws of shortPieces) {
    const hit = ws.find((w) => WEAK_SET.has(w));
    if (hit !== undefined) return `the address says «${hit}»: an action, not a page`;
  }
  for (const glued of raw) {
    if (/^(logout|signout|logoff|addto)/.test(glued)) return `the address says «${glued}»: an action, not a page`;
  }
  const all = new Set(words);
  if (all.has("add") && [...all].some((w) => ADD_TARGETS.has(w))) return "the address adds something (add to cart…): an action, not a page";
  if (/(^|[^a-z])(add[-_]?to[-_]?(cart|basket|bag|wishlist))/i.test(`${u.pathname}${u.search}`)) return "the address adds something (add to cart…): an action, not a page";
  return null;
}

/** Link texts that are actions, whatever the address says. */
export const ACTION_TEXT = /^\s*(log ?out|log ?off|sign ?out|cerrar sesi[oó]n|salir|delete|remove|unsubscribe|cancel|borrar|eliminar|darse de baja|vaciar|empty cart|add to cart|añadir al carrito|buy now|comprar ahora)\b/i;
