import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTS, Shop, ShopError } from "./shop.ts";

const PORT = Number(process.env["PORT"] ?? 3000);
const HOST = process.env["HOST"] ?? "127.0.0.1";
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const MEDIA_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const shop = new Shop();

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += String(chunk);
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // Fall through to the error below.
  }
  throw new ShopError(400, "Request body must be a JSON object");
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  const match = header === undefined ? null : /^Bearer (\S+)$/.exec(header);
  return match?.[1];
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = `${req.method ?? "GET"} ${url.pathname}`;

  if (route === "GET /api/health") return sendJson(res, 200, { ok: true });
  if (route === "GET /api/products") return sendJson(res, 200, PRODUCTS);
  if (route === "POST /api/session") return sendJson(res, 201, { token: shop.createSession() });

  const session = shop.getSession(bearerToken(req));
  if (route === "GET /api/cart") return sendJson(res, 200, shop.viewCart(session));
  if (route === "DELETE /api/cart") return sendJson(res, 200, shop.clearCart(session));
  if (route === "POST /api/cart/items") {
    const body = await readJsonBody(req);
    const quantity = body["quantity"] === undefined ? 1 : Number(body["quantity"]);
    return sendJson(res, 200, shop.addItem(session, stringField(body, "productId"), quantity));
  }
  const removeMatch = /^DELETE \/api\/cart\/items\/([\w-]+)$/.exec(route);
  if (removeMatch?.[1] !== undefined) return sendJson(res, 200, shop.removeItem(session, removeMatch[1]));
  if (route === "POST /api/cart/coupon") {
    const body = await readJsonBody(req);
    return sendJson(res, 200, shop.applyCoupon(session, stringField(body, "code")));
  }
  if (route === "POST /api/checkout") return sendJson(res, 201, shop.checkout(session));
  if (route === "GET /api/orders") return sendJson(res, 200, shop.listOrders(session));

  throw new ShopError(404, `No route for ${route}`);
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const relativePath = pathname === "/" ? "index.html" : normalize(pathname).replace(/^[\\/]+/, "");
  const mediaType = MEDIA_TYPES[extname(relativePath)];
  if (relativePath.includes("..") || mediaType === undefined) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  try {
    const content = await readFile(join(PUBLIC_DIR, relativePath));
    res.writeHead(200, { "content-type": mediaType }).end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const handler = url.pathname.startsWith("/api/") ? handleApi(req, res, url) : serveStatic(res, url.pathname);
  handler.catch((error: unknown) => {
    if (error instanceof ShopError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`buggy-shop listening on http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT}`);
});
