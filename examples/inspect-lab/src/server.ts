import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { handleAccess } from "./access.ts";
import { misconfiguredHandler } from "./misconfigured.ts";
import { handleSearch } from "./search.ts";
import { handleTraps, trapHits } from "./traps.ts";

/*
 * inspect-lab: the fixture of `exegezis inspect`.
 *
 * Seeded problems, all on "/" unless noted (the ground truth of the tests):
 *   - uncaught exception         ReferenceError: lab is not defined
 *   - console error              "Inventory service unavailable"
 *   - failing request            GET /api/fail → 500 (always)
 *   - intermittent request       GET /api/flaky → 500 on odd calls, 200 on even calls
 *   - broken internal link       /broken-page → 404
 *   - accessibility violation    <img id="hero"> without alt (axe image-alt)
 *   - mixed content (HTTPS only) <script src="http://…/insecure.js">
 * Also: /forms has a POST form and buttons that POST (the inspection must
 * never trigger them) and posts /api/track by itself on load (a page write);
 * /private/* is disallowed by robots.txt; /blocked/ is a CAPTCHA wall;
 * /slow-assets/ has its own stylesheet and script that take 20 s (the page is
 * still inspected, not settled).
 * /healthy/ is a healthy section (0 findings expected): every security
 * header, nothing heavy, listed in a valid sitemap named in robots.txt; the
 * site answers unknown addresses with a real 404.
 * misconfigured.ts is a whole misconfigured site on MISCONFIG_PORT (and
 * MISCONFIG_TLS_PORT with its own certificate): headers, cookie, heavy
 * files, a slow page, a broken sitemap, a soft 404.
 * /access/* are the access fixtures, one per block kind (see access.ts).
 * /search/* are the search fixtures (see search.ts).
 * /traps/ links to endpoints that act (see traps.ts): an inspection calls none.
 * /devices/ is the desktop and mobile fixture: on a phone it scrolls
 * sideways (a 600 px table), has a 16×16 button, 10 px text, a meta viewport
 * that blocks zoom and a fixed banner over half the screen; a console error
 * only on wide screens ("desktop only") and one on every screen ("both").
 * /devices/fine is the same page done right (0 mobile findings): its small
 * checkbox is inside a tall label, a visually hidden link and one 23.6 px tall
 * (24 once rounded) are not small targets.
 * /groups/ (3 pages) repeats one low-contrast card (#9ca3af on white) on
 * every page, adds a second colour pair (#c4862a on white) on /groups/b, and
 * logs a console error whose numbers change on every load: issue grouping
 * must give 1 group per colour pair and 1 group for the error.
 *
 *   PORT=4300 node src/server.ts
 *   HTTPS_PORT=4443 TLS_KEY_FILE=key.pem TLS_CERT_FILE=cert.pem PORT=4300 node src/server.ts
 *   MISCONFIG_PORT=4301 MISCONFIG_TLS_PORT=4444 MISCONFIG_KEY_FILE=… MISCONFIG_CERT_FILE=… PORT=4300 node src/server.ts
 */

const PORT = Number(process.env["PORT"] ?? 4300);
const HTTPS_PORT = process.env["HTTPS_PORT"] === undefined ? null : Number(process.env["HTTPS_PORT"]);
const HOST = "127.0.0.1";

const writes = new Map<string, number>();
let flakyCalls = 0;

const page = (title: string, body: string, head = "") => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head>
<body>${body}</body>
</html>`;

function home(secure: boolean): string {
  const insecure = secure ? `<script src="http://${HOST}:${PORT}/insecure.js"></script>` : "";
  return page(
    "Inspect Lab",
    `<header><nav aria-label="Main">
      <a href="/about">About</a>
      <a href="/forms">Forms</a>
      <a href="/broken-page">Old page</a>
      <a href="/private/secret">Private</a>
      <a href="https://example.org/">Example (external)</a>
      <a href="http://[bad">Malformed address</a>
    </nav></header>
    <main>
      <h1>Inspect Lab</h1>
      <img id="hero" src="/hero.svg" width="120" height="40">
      <p>Seeded problems live on this page.</p>
    </main>
    ${insecure}
    <script>
      console.error("Inventory service unavailable");
      fetch("/api/fail");
      fetch("/api/flaky");
      setTimeout(() => { lab.start(); }, 0);
    </script>`,
  );
}

const ABOUT = page("About", `<main><h1>About</h1><p>A plain page with nothing wrong.</p><a href="/">Home</a></main>`);

const FORMS = page(
  "Forms",
  `<main>
    <h1>Forms</h1>
    <form method="post" action="/api/subscribe">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="ana@example.com">
      <button type="submit">Subscribe</button>
    </form>
    <button type="button" id="like">Like</button>
    <a href="/">Home</a>
  </main>
  <script>
    document.getElementById("like").addEventListener("click", () => fetch("/api/like", { method: "POST" }));
    fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: '{"event":"view"}' });
  </script>`,
);

const BLOCKED = page("Attention Required", `<main><h1>Verify you are human</h1><div class="g-recaptcha" data-sitekey="lab"></div></main>`);

const HEALTHY = page(
  "Healthy",
  `<style>nav a{display:inline-block;padding:12px 8px}</style><header><nav aria-label="Main"><a href="/healthy/">Home</a> <a href="/healthy/about">About</a></nav></header>
   <main><h1>Healthy site</h1><img src="/hero.svg" alt="Lab logo" width="120" height="40"><p>Nothing to find here.</p></main>
   <script>fetch("/api/ok");</script>`,
);
const DEVICES_BAD = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"><title>Devices</title>
<style>body{margin:0;font:16px/1.5 sans-serif}main{padding:16px}#wide{width:600px;border:1px solid #333}#tiny{width:16px;height:16px;padding:0;border:1px solid #333}.fine{font-size:10px}#banner{position:fixed;left:0;right:0;bottom:0;height:50vh;background:#1f2937;color:#fff}</style></head>
<body><main><h1>Devices</h1>
<table id="wide"><tr><td>A table 600 px wide</td></tr></table>
<button id="tiny" type="button" aria-label="Close"></button>
<p class="fine">The fine print, in 10 px.</p>
<a href="/devices/fine">The page done right</a>
</main><div id="banner">Subscribe to our newsletter</div>
<script>
  console.error("Shown on every screen");
  if (window.matchMedia("(min-width: 800px)").matches) console.error("Only on wide screens");
</script></body></html>`;

const DEVICES_FINE = page(
  "Devices · fine",
  `<main><h1>Done right</h1><p>Readable text, big enough targets, nothing over the content.</p><a href="/devices/" style="display:inline-block;padding:12px">Back</a>
   <form><label style="display:inline-flex;align-items:center;gap:8px;padding:6px 0"><input type="checkbox" style="width:13px;height:13px"> A small box inside a tall label</label></form>
   <a href="/devices/" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Visually hidden</a>
   <a href="/devices/" style="display:inline-block;width:120px;height:23.6px">Almost 24 px</a></main>`,
);

const HEALTHY_ABOUT = page("Healthy · About", `<main><h1>About the healthy site</h1><a href="/healthy/" style="display:inline-block;padding:12px 8px">Back</a></main>`);

/** The same low-contrast card on every /groups/ page, at a different position each time. */
function groupsPage(name: string, extra: string, filler: number): string {
  const nav = `<nav aria-label="Main"><a href="/groups/">Home</a> <a href="/groups/a">A</a> <a href="/groups/b">B</a></nav>`;
  const spacers = Array.from({ length: filler }, () => "<p>Filler paragraph.</p>").join("");
  return page(
    `Groups · ${name}`,
    `<header>${nav}</header><main><h1>Groups ${name}</h1>${spacers}
     <div class="card"><p class="card__note" style="color:#9ca3af;background:#ffffff">Low-contrast note, the same component everywhere.</p></div>
     ${extra}</main>
     <script>console.error("Request " + Math.floor(Math.random() * 100000) + " failed after " + Date.now() % 1000 + " ms");</script>`,
  );
}

/** What a well-configured site sends with its pages (the healthy section). */
const SAFE_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function send(res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(body);
}

function handler(secure: boolean) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://lab.test");
    if (url.pathname.startsWith("/access/") || url.pathname === "/__lab/access" || url.pathname === "/__lab/expire-sessions" || url.pathname === "/__lab/waf-token") {
      void handleAccess(req, res, url, PORT).then((handled) => {
        if (!handled) send(res, 404, "text/plain", "Not found");
      });
      return;
    }
    if ((url.pathname.startsWith("/search/") || url.pathname === "/__lab/search-reset") && handleSearch(res, url)) return;
    if (handleTraps(res, url)) return;
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const key = `${method} ${url.pathname}`;
      writes.set(key, (writes.get(key) ?? 0) + 1);
    }
    switch (url.pathname) {
      case "/":
        return send(res, 200, "text/html; charset=utf-8", home(secure));
      case "/about":
        return send(res, 200, "text/html; charset=utf-8", ABOUT);
      case "/forms":
        return send(res, 200, "text/html; charset=utf-8", FORMS);
      case "/blocked/":
        return send(res, 403, "text/html; charset=utf-8", BLOCKED);
      case "/healthy/":
        return send(res, 200, "text/html; charset=utf-8", HEALTHY, SAFE_HEADERS);
      case "/devices/":
        return send(res, 200, "text/html; charset=utf-8", DEVICES_BAD);
      case "/devices/fine":
        return send(res, 200, "text/html; charset=utf-8", DEVICES_FINE);
      case "/healthy/about":
        return send(res, 200, "text/html; charset=utf-8", HEALTHY_ABOUT, SAFE_HEADERS);
      case "/groups/":
        return send(res, 200, "text/html; charset=utf-8", groupsPage("home", "", 0));
      case "/groups/a":
        return send(res, 200, "text/html; charset=utf-8", groupsPage("A", "", 2));
      case "/groups/b":
        return send(res, 200, "text/html; charset=utf-8", groupsPage("B", `<p class="badge" style="color:#c4862a;background:#ffffff">Gold badge text, another colour pair.</p>`, 1));
      case "/private/secret":
        return send(res, 200, "text/html; charset=utf-8", page("Private", "<main><h1>Private</h1></main>"));
      case "/hero.svg":
        return send(res, 200, "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40"/></svg>', { "cache-control": "max-age=3600" });
      case "/insecure.js":
        return send(res, 200, "text/javascript", "window.insecureLoaded = true;");
      case "/favicon.ico":
        return send(res, 204, "image/x-icon", "");
      case "/robots.txt":
        return send(res, 200, "text/plain", `User-agent: *\nDisallow: /private/\nSitemap: ${secure ? "https" : "http"}://${req.headers.host ?? HOST}/sitemap.xml\n`);
      case "/sitemap.xml": {
        const base = `${secure ? "https" : "http"}://${req.headers.host ?? HOST}`;
        return send(res, 200, "application/xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/healthy/</loc></url><url><loc>${base}/healthy/about</loc></url></urlset>\n`);
      }
      case "/api/ok":
        return send(res, 200, "application/json", '{"ok":true}');
      case "/api/fail":
        return send(res, 500, "application/json", '{"error":"inventory backend down"}');
      case "/api/flaky":
        flakyCalls += 1;
        return flakyCalls % 2 === 1 ? send(res, 500, "application/json", '{"error":"flaky"}') : send(res, 200, "application/json", '{"ok":true}');
      case "/api/track":
      case "/api/subscribe":
      case "/api/like":
        return send(res, method === "POST" ? 200 : 405, "application/json", '{"ok":true}');
      case "/iframes/": {
        // Its own nameless button, and another site's widget in an iframe with one too.
        const widget = process.env["MISCONFIG_TLS_PORT"] === undefined ? "about:blank" : `https://localhost:${process.env["MISCONFIG_TLS_PORT"]}/widget`;
        return send(res, 200, "text/html; charset=utf-8", page("Iframes", `<main><h1>A page with a widget</h1><button type="button" id="own"></button><iframe src="${widget}" title="Chat" width="300" height="120"></iframe></main>`));
      }
      case "/app-error/":
        // What Next.js shows when a chunk fails to load (a dropped connection): its own error page.
        return send(res, 200, "text/html; charset=utf-8", '<!DOCTYPE html><html id="__next_error__"><head><meta charset="utf-8"></head><body><h2>Application error: a client-side exception has occurred while loading 127.0.0.1 (see the browser console for more information).</h2></body></html>');
      case "/contact-captcha/":
        // A short contact page whose form has a CAPTCHA: the form's, not a wall (practicetestautomation.com/contact).
        return send(res, 200, "text/html; charset=utf-8", page("Contact", '<main><h1>Contact</h1><form><label>Name <input name="name"></label><label>Email <input name="email" type="email"></label><label>Message <textarea name="message"></textarea></label><div class="g-recaptcha" data-sitekey="lab" style="width:304px;height:78px"></div><button type="submit">Send</button></form></main>'));
      case "/slow-assets/":
        // Its own stylesheet hangs for 20 s: DOMContentLoaded comes late (as on the-internet.herokuapp.com).
        return send(res, 200, "text/html; charset=utf-8", page("Slow assets", "<main><h1>Slow assets</h1><p>The stylesheet of this page takes 20 s.</p></main>", '<link rel="stylesheet" href="/slow-assets/style.css"><script src="/slow-assets/app.js"></script>'));
      case "/slow-assets/style.css":
      case "/slow-assets/app.js":
        setTimeout(() => send(res, 200, url.pathname.endsWith(".css") ? "text/css" : "text/javascript", ""), 20_000);
        return;
      case "/__lab/health":
        return send(res, 200, "application/json", '{"ok":true}');
      case "/__lab/stats":
        return send(res, 200, "application/json", JSON.stringify({ writes: Object.fromEntries(writes), flakyCalls, traps: trapHits() }));
      default:
        return send(res, 404, "text/plain", "Not found");
    }
  };
}

createHttpServer(handler(false)).listen(PORT, HOST, () => console.log(`inspect-lab http://${HOST}:${PORT}/`));
const MISCONFIG_PORT = process.env["MISCONFIG_PORT"];
if (MISCONFIG_PORT !== undefined) createHttpServer(misconfiguredHandler).listen(Number(MISCONFIG_PORT), HOST);
const MISCONFIG_TLS_PORT = process.env["MISCONFIG_TLS_PORT"];
if (MISCONFIG_TLS_PORT !== undefined) {
  const key = readFileSync(process.env["MISCONFIG_KEY_FILE"] ?? "", "utf8");
  const cert = readFileSync(process.env["MISCONFIG_CERT_FILE"] ?? "", "utf8");
  createHttpsServer({ key, cert }, misconfiguredHandler).listen(Number(MISCONFIG_TLS_PORT), HOST);
}
if (HTTPS_PORT !== null) {
  const key = readFileSync(process.env["TLS_KEY_FILE"] ?? "", "utf8");
  const cert = readFileSync(process.env["TLS_CERT_FILE"] ?? "", "utf8");
  createHttpsServer({ key, cert }, handler(true)).listen(HTTPS_PORT, HOST, () => console.log(`inspect-lab https://${HOST}:${HTTPS_PORT}/`));
}
