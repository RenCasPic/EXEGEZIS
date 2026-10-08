import type { IncomingMessage, ServerResponse } from "node:http";
import { deflateSync } from "node:zlib";

/*
 * A misconfigured site, on a port of its own (the site checks are about a
 * whole origin): the backend and performance problems seen from outside.
 *   - no security headers at all (HSTS on HTTPS, CSP, nosniff, framing, Referrer-Policy, Permissions-Policy)
 *   - a session cookie without Secure, HttpOnly or SameSite        "/" sets sessionid
 *   - a 430 KB PNG (not WebP/AVIF), without caching               /big.png
 *   - JavaScript of 40 KB without compression nor caching          /app.js
 *   - a page that takes 2.5 s to start answering                    /slow
 *   - a sitemap listing a page that answers 404                     /sitemap.xml → /gone
 *   - any unknown address answers 200 with a "not found" page      (soft 404)
 * Over HTTPS, the test gives it a certificate that expires in 10 days.
 */

/** A valid PNG of deterministic noise (it cannot be compressed): 380×380 px, about 430 KB. */
function noisePng(size: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  let seed = 12345;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0; // no filter
    for (let i = 1; i <= size * 3; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      raw[row + i] = seed >>> 24;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
}

const BIG_PNG = noisePng(380);
const APP_JS = `/* lab */\n${"window.labPadding = 'x';\n".repeat(1700)}`;

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body><main><h1>${title}</h1>${body}</main></body>
</html>`;

export function misconfiguredHandler(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://lab.test");
  const base = `${(req.socket as { encrypted?: boolean }).encrypted === true ? "https" : "http"}://${req.headers.host ?? "127.0.0.1"}`;
  const html = (body: string, headers: Record<string, string> = {}) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(body);
  };
  switch (url.pathname) {
    case "/":
      return html(page("Misconfigured", `<p>Everything here is set up wrong.</p><img src="/big.png" alt="A heavy photo" width="320" height="200"><a href="/slow">A slow page</a><script src="/app.js"></script>`), {
        "set-cookie": "sessionid=lab-session-value; Path=/",
      });
    case "/slow":
      setTimeout(() => html(page("Slow", `<p>This page took 2.5 s to start answering.</p><a href="/">Home</a>`)), 2500);
      return;
    case "/big.png":
      res.writeHead(200, { "content-type": "image/png", "content-length": String(BIG_PNG.length) });
      res.end(BIG_PNG);
      return;
    case "/app.js":
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(APP_JS);
      return;
    case "/robots.txt":
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
      return;
    case "/sitemap.xml":
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url><url><loc>${base}/gone</loc></url></urlset>\n`);
      return;
    case "/gone":
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Gone");
      return;
    case "/widget":
      // Another site's widget (a chat, a cookie banner) with a button without a name.
      return html('<!doctype html><html lang="en"><head><title>Widget</title></head><body><button type="button"></button></body></html>');
    case "/favicon.ico":
      res.writeHead(204);
      res.end();
      return;
    default:
      // A soft 404: the "not found" page answers 200.
      return html(page("Page not found", "<p>Sorry, this page does not exist.</p>"));
  }
}
