import type { ServerResponse } from "node:http";

/*
 * Trap links (docs/07-web-inspection.md §4, «Política de enlaces»): /traps/
 * links to endpoints that would act on a real site — delete an account,
 * remove an item, log out, unsubscribe, cancel an order, add to a cart —, to
 * technical routes, through a form, onclick, data-href, rel="nofollow", a
 * download and a redirect. Every call to a trap is counted (any method); an
 * inspection must leave every counter at 0. /traps/ok is the one page to visit.
 */

export const TRAP_LINKS = [
  "/traps/api/deleteAccount",
  "/traps/account/deleteaccount",
  "/traps/cart/removeItem/3",
  "/traps/log-out",
  "/traps/user/logOutAll",
  "/traps/newsletter/unsubscribe?email=ana%40example.com",
  "/traps/orders/9/cancel",
  "/traps/cart/add-to-cart?id=1",
  "/traps/item?action=delete&_wpnonce=abc123",
  "/traps/wp-admin/",
  "/traps/admin/reset",
  "/traps/confirm-email",
];

const hits = new Map<string, number>();

export function trapHits(): Record<string, number> {
  return Object.fromEntries(hits);
}

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Traps</title></head>
<body><main><h1>Trap links</h1><p>Each of these would act on a real site. An inspection must never call them.</p>
<ul>
${TRAP_LINKS.map((href, i) => `<li><a href="${href.replace(/&/g, "&amp;")}" style="display:inline-block;padding:12px 8px">Trap ${i + 1}</a></li>`).join("\n")}
<li><a href="/traps/nofollow" rel="nofollow" style="display:inline-block;padding:12px 8px">Not followed (nofollow)</a></li>
<li><a href="/traps/report.pdf" download style="display:inline-block;padding:12px 8px">A download</a></li>
<li><a href="/traps/go" style="display:inline-block;padding:12px 8px">A page that redirects to logging out</a></li>
<li><a href="/traps/ok" style="display:inline-block;padding:12px 8px">An ordinary page</a></li>
</ul>
<form action="/traps/form-action" method="get"><label>Search <input name="q"></label><button type="submit">Go</button></form>
<button type="button" onclick="fetch('/traps/onclick')" style="padding:12px 8px">Click</button>
<div data-href="/traps/data-href">A card with data-href</div>
</main></body>
</html>`;

const OK = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ordinary</title></head>
<body><main><h1>An ordinary page</h1><a href="/traps/" style="display:inline-block;padding:12px 8px">Back</a></main></body>
</html>`;

/** Serves /traps/*; true when it answered. */
export function handleTraps(res: ServerResponse, url: URL): boolean {
  if (!url.pathname.startsWith("/traps/")) return false;
  if (url.pathname === "/traps/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return true;
  }
  if (url.pathname === "/traps/ok") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(OK);
    return true;
  }
  if (url.pathname === "/traps/go") {
    res.writeHead(302, { location: "/traps/logout-now" });
    res.end();
    return true;
  }
  // Everything else under /traps/ is a trap: counted, whatever the method.
  hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("A trap was called");
  return true;
}
