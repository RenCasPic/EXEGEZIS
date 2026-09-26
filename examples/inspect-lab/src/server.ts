import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";

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
 * /healthy/ is a healthy section (0 findings expected).
 * /groups/ (3 pages) repeats one low-contrast card (#9ca3af on white) on
 * every page, adds a second colour pair (#c4862a on white) on /groups/b, and
 * logs a console error whose numbers change on every load: issue grouping
 * must give 1 group per colour pair and 1 group for the error.
 *
 *   PORT=4300 node src/server.ts
 *   HTTPS_PORT=4443 TLS_KEY_FILE=key.pem TLS_CERT_FILE=cert.pem PORT=4300 node src/server.ts
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
  `<header><nav aria-label="Main"><a href="/healthy/">Home</a> <a href="/healthy/about">About</a></nav></header>
   <main><h1>Healthy site</h1><img src="/hero.svg" alt="Lab logo" width="120" height="40"><p>Nothing to find here.</p></main>
   <script>fetch("/api/ok");</script>`,
);
const HEALTHY_ABOUT = page("Healthy · About", `<main><h1>About the healthy site</h1><a href="/healthy/">Back</a></main>`);

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

function send(res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(body);
}

function handler(secure: boolean) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? "/", "http://lab.test");
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
        return send(res, 200, "text/html; charset=utf-8", HEALTHY);
      case "/healthy/about":
        return send(res, 200, "text/html; charset=utf-8", HEALTHY_ABOUT);
      case "/groups/":
        return send(res, 200, "text/html; charset=utf-8", groupsPage("home", "", 0));
      case "/groups/a":
        return send(res, 200, "text/html; charset=utf-8", groupsPage("A", "", 2));
      case "/groups/b":
        return send(res, 200, "text/html; charset=utf-8", groupsPage("B", `<p class="badge" style="color:#c4862a;background:#ffffff">Gold badge text, another colour pair.</p>`, 1));
      case "/private/secret":
        return send(res, 200, "text/html; charset=utf-8", page("Private", "<main><h1>Private</h1></main>"));
      case "/hero.svg":
        return send(res, 200, "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40"/></svg>');
      case "/insecure.js":
        return send(res, 200, "text/javascript", "window.insecureLoaded = true;");
      case "/favicon.ico":
        return send(res, 204, "image/x-icon", "");
      case "/robots.txt":
        return send(res, 200, "text/plain", "User-agent: *\nDisallow: /private/\n");
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
      case "/__lab/health":
        return send(res, 200, "application/json", '{"ok":true}');
      case "/__lab/stats":
        return send(res, 200, "application/json", JSON.stringify({ writes: Object.fromEntries(writes), flakyCalls }));
      default:
        return send(res, 404, "text/plain", "Not found");
    }
  };
}

createHttpServer(handler(false)).listen(PORT, HOST, () => console.log(`inspect-lab http://${HOST}:${PORT}/`));
if (HTTPS_PORT !== null) {
  const key = readFileSync(process.env["TLS_KEY_FILE"] ?? "", "utf8");
  const cert = readFileSync(process.env["TLS_CERT_FILE"] ?? "", "utf8");
  createHttpsServer({ key, cert }, handler(true)).listen(HTTPS_PORT, HOST, () => console.log(`inspect-lab https://${HOST}:${HTTPS_PORT}/`));
}
