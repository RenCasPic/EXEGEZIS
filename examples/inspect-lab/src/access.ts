import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/*
 * Access fixtures (docs/09-access.md §6), one per block kind. The app is
 * served on http://127.0.0.1:<port>; http://localhost:<port> is "another
 * origin" (a third party, and the identity provider of the SSO fixture).
 *
 *   /access/app/            login with a cookie; links to profile, logout and a destructive GET
 *   /access/sign-in         the login form (rene / lab-password)
 *   /access/sso-app/        login through an identity provider on localhost
 *   /access/basic/          HTTP Basic auth (rene / basic-pass)
 *   /access/challenge/      an imitation of an anti-bot challenge (403 + .cf-turnstile)
 *   /access/limited/        429 with Retry-After: 1 twice, then 200
 *   /access/limited-hard/   429 with Retry-After: 120, always
 *   /access/forbidden/      403 without a challenge
 *   /access/consent/        a cookie banner that covers the page and locks scrolling
 *   /access/news/           a login box in the header next to real content (NOT a wall)
 *
 * State endpoints (tests only): /__lab/access (counters),
 * /__lab/expire-sessions (every issued session stops working),
 * /__lab/waf-token?value=… (the "WAF rule" that lets that token through).
 */

const sessions = new Set<string>();
const idpSessions = new Set<string>();
const counters = { logout: 0, destructive: 0, tokenToThirdParty: 0, tokenToApp: 0, limited: 0 };
let wafToken: string | null = null;
const clearances = new Set<string>();

const page = (title: string, body: string, head = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${head}</head>
<body>${body}</body></html>`;

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(body);
}

async function form(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return new URLSearchParams(body);
}

const APP_NAV = `<nav aria-label="Account"><a href="/access/app/">Home</a> <a href="/access/app/profile">Profile</a> <a href="/access/app/logout">Log out</a> <a href="/access/app/delete-account?id=1">Delete my account</a></nav>`;
const LONG = "<p>" + "This is the member area with the real content of the page. ".repeat(12) + "</p>";

export function accessStats(): object {
  return { ...counters, sessions: sessions.size, wafToken: wafToken !== null };
}

/** Handles /access/* and the access lab endpoints. Returns false when the path is not an access route. */
export async function handleAccess(req: IncomingMessage, res: ServerResponse, url: URL, port: number): Promise<boolean> {
  const host = (req.headers.host ?? "").split(":")[0];
  const appOrigin = `http://127.0.0.1:${port}`;
  const idpOrigin = `http://localhost:${port}`;
  const c = cookies(req);
  const token = req.headers["x-exegezis-token"];

  switch (url.pathname) {
    case "/__lab/access":
      send(res, 200, JSON.stringify(accessStats()), { "content-type": "application/json" });
      return true;
    case "/__lab/expire-sessions":
      sessions.clear();
      send(res, 200, "{}", { "content-type": "application/json" });
      return true;
    case "/__lab/waf-token":
      wafToken = url.searchParams.get("value");
      send(res, 200, "{}", { "content-type": "application/json" });
      return true;
    case "/access/pixel":
      // Served on localhost: a third party. The WAF token must never reach it.
      if (token !== undefined) counters.tokenToThirdParty += 1;
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
      return true;
  }

  // Login with a cookie.
  if (url.pathname === "/access/sign-in") {
    if (req.method === "POST") {
      const f = await form(req);
      if (f.get("username") === "rene" && f.get("password") === "lab-password") {
        const id = randomBytes(16).toString("hex");
        sessions.add(id);
        const next = f.get("next") ?? "/access/app/";
        send(res, 302, "", { location: next.startsWith("/") ? next : "/access/app/", "set-cookie": `lab_session=${id}; Path=/; HttpOnly; Max-Age=86400` });
      } else send(res, 401, page("Sign in", "<main><h1>Wrong password</h1></main>"));
      return true;
    }
    const next = url.searchParams.get("next") ?? "/access/app/";
    send(
      res,
      200,
      page(
        "Sign in",
        `<header><a href="/access/news/">News</a></header><main><h1>Sign in</h1>
         <form method="post" action="/access/sign-in"><input type="hidden" name="next" value="${next.replace(/"/g, "")}">
         <label>User <input name="username" autocomplete="username"></label>
         <label>Password <input type="password" name="password" autocomplete="current-password"></label>
         <button type="submit">Sign in</button></form></main>`,
      ),
    );
    return true;
  }
  if (url.pathname.startsWith("/access/app/")) {
    if (!sessions.has(c["lab_session"] ?? "")) {
      send(res, 302, "", { location: `/access/sign-in?next=${encodeURIComponent(url.pathname + url.search)}` });
      return true;
    }
    if (url.pathname === "/access/app/logout") {
      counters.logout += 1;
      sessions.delete(c["lab_session"] ?? "");
      send(res, 302, "", { location: "/access/sign-in", "set-cookie": "lab_session=; Path=/; Max-Age=0" });
      return true;
    }
    if (url.pathname === "/access/app/delete-account") {
      counters.destructive += 1;
      send(res, 200, page("Deleted", "<main><h1>Your account was deleted</h1></main>"));
      return true;
    }
    const title = url.pathname === "/access/app/profile" ? "Profile" : "Member area";
    send(res, 200, page(title, `<header>${APP_NAV}</header><main><h1>${title}</h1>${LONG}</main>`));
    return true;
  }

  // SSO: the app on 127.0.0.1, the identity provider on localhost.
  if (url.pathname.startsWith("/access/sso-app/")) {
    if (!sessions.has(c["lab_session"] ?? "")) {
      send(res, 302, "", { location: `${idpOrigin}/access/idp/login?return=${encodeURIComponent(`${appOrigin}/access/sso-callback`)}` });
      return true;
    }
    send(res, 200, page("SSO member area", `<main><h1>SSO member area</h1>${LONG}</main>`));
    return true;
  }
  if (url.pathname === "/access/idp/login") {
    const ret = url.searchParams.get("return") ?? `${appOrigin}/access/sso-callback`;
    if (req.method === "POST") {
      const f = await form(req);
      if (f.get("password") === "idp-password") {
        const idp = randomBytes(16).toString("hex");
        idpSessions.add(idp);
        const ticket = randomBytes(8).toString("hex");
        send(res, 302, "", { location: `${f.get("return") ?? ret}?ticket=${ticket}`, "set-cookie": `idp_session=${idp}; Path=/; HttpOnly; Max-Age=86400` });
      } else send(res, 401, page("IdP", "<main><h1>Wrong password</h1></main>"));
      return true;
    }
    send(
      res,
      200,
      page(
        "Identity provider",
        `<main><h1>Sign in with LabID</h1><form method="post" action="/access/idp/login?return=${encodeURIComponent(ret)}"><input type="hidden" name="return" value="${ret}">
         <label>Password <input type="password" name="password"></label><button type="submit">Continue</button></form></main>`,
      ),
    );
    return true;
  }
  if (url.pathname === "/access/sso-callback") {
    const id = randomBytes(16).toString("hex");
    sessions.add(id);
    send(res, 302, "", { location: "/access/sso-app/", "set-cookie": `lab_session=${id}; Path=/; HttpOnly; Max-Age=86400` });
    return true;
  }

  if (url.pathname.startsWith("/access/basic/")) {
    const expected = `Basic ${Buffer.from("rene:basic-pass").toString("base64")}`;
    if (req.headers.authorization !== expected) {
      send(res, 401, page("Unauthorized", "<main><h1>Authentication required</h1></main>"), { "www-authenticate": 'Basic realm="lab staff"' });
      return true;
    }
    send(res, 200, page("Staff area", `<main><h1>Staff area</h1>${LONG}</main>`));
    return true;
  }

  if (url.pathname.startsWith("/access/challenge/")) {
    if (typeof token === "string") counters.tokenToApp += 1;
    const allowed = (wafToken !== null && token === wafToken) || clearances.has(c["cf_clearance"] ?? "");
    if (req.method === "POST" && url.pathname === "/access/challenge/verify") {
      // The person "passes the verification" in the visible window.
      const id = randomBytes(16).toString("hex");
      clearances.add(id);
      send(res, 302, "", { location: "/access/challenge/", "set-cookie": `cf_clearance=${id}; Path=/; HttpOnly; Max-Age=3600` });
      return true;
    }
    if (!allowed) {
      send(
        res,
        403,
        page(
          "Just a moment...",
          `<main><h1>Verify you are human</h1><div class="cf-turnstile" data-sitekey="lab"></div>
           <form method="post" action="/access/challenge/verify"><button type="submit">I am human</button></form></main>`,
        ),
        { server: "cloudflare", "cf-mitigated": "challenge" },
      );
      return true;
    }
    send(res, 200, page("Protected content", `<main><h1>Protected content</h1>${LONG}<img src="${idpOrigin}/access/pixel" alt="" width="1" height="1"></main>`));
    return true;
  }

  if (url.pathname === "/access/limited/") {
    counters.limited += 1;
    if (counters.limited % 3 !== 0) {
      send(res, 429, page("Too many requests", "<main><h1>Slow down</h1></main>"), { "retry-after": "1" });
      return true;
    }
    send(res, 200, page("Limited", `<main><h1>Rate-limited page</h1>${LONG}</main>`));
    return true;
  }
  if (url.pathname === "/access/limited-hard/") {
    send(res, 429, page("Too many requests", "<main><h1>Slow down</h1></main>"), { "retry-after": "120" });
    return true;
  }
  if (url.pathname === "/access/forbidden/") {
    send(res, 403, page("Forbidden", "<main><h1>Forbidden</h1><p>Your network is not allowed.</p></main>"));
    return true;
  }

  if (url.pathname.startsWith("/access/consent/")) {
    if (req.method === "POST") {
      const f = await form(req);
      send(res, 302, "", { location: "/access/consent/", "set-cookie": `lab_consent=${f.get("choice") === "accept" ? "all" : "necessary"}; Path=/; Max-Age=86400` });
      return true;
    }
    const decided = c["lab_consent"] !== undefined;
    const banner = decided
      ? ""
      : `<div id="consent" style="position:fixed;inset:0;background:rgba(0,0,0,.85);color:#fff;display:flex;align-items:center;justify-content:center;z-index:10">
           <div><h2>We use cookies</h2><p>Choose which cookies you accept before continuing.</p>
           <form method="post" action="/access/consent/"><button name="choice" value="reject">Reject all</button> <button name="choice" value="accept">Accept all</button></form></div></div>`;
    send(res, 200, page("Consent", `${banner}<main><h1>Article behind a consent wall</h1>${LONG}</main>`, decided ? "" : "<style>body{overflow:hidden}</style>"));
    return true;
  }

  if (url.pathname === "/access/news/") {
    send(
      res,
      200,
      page(
        "News",
        `<header><form method="post" action="/access/sign-in"><label>User <input name="username"></label><label>Password <input type="password" name="password"></label><button>Sign in</button></form></header>
         <main><article><h1>Today's news</h1>${LONG}</article></main>`,
      ),
    );
    return true;
  }

  void host;
  return false;
}
