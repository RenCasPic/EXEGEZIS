import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** Secret values the fixture app sends around. None may appear in any artifact. */
export const FIXTURE_SECRETS = {
  bearer: "sk-fixture-SECRET-123456",
  apiKey: "apikey-fixture-456789",
  cookie: "cookie-secret-abcdef",
  responseToken: "resp-token-789xyz",
  password: "fixture-password-xyz",
  queryToken: "qs-token-000111",
} as const;

const HOME = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture Home</title></head>
<body>
  <nav><a href="/products">Products</a></nav>
  <main>
    <h1>Shopping Cart</h1>
    <form id="login">
      <label>Email <input type="email" name="email"></label>
      <label>Password <input type="password" name="password"></label>
      <button type="submit">Sign in</button>
    </form>
    <p id="result" role="status"></p>
    <button type="button">Checkout</button>
  </main>
  <script>
    console.log("fixture: log");
    console.info("fixture: info");
    console.warn("fixture: warning");
    console.error("fixture: error");
    console.debug("fixture: debug");
    fetch("/api/data?token=${FIXTURE_SECRETS.queryToken}&page=1", {
      headers: { Authorization: "Bearer ${FIXTURE_SECRETS.bearer}", "X-API-Key": "${FIXTURE_SECRETS.apiKey}" },
    })
      .then((r) => r.json())
      .then((data) => console.log("fixture: loaded " + data.items.length + " items"));
    document.getElementById("login").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const body = await response.json();
      document.getElementById("result").textContent = "Signed in as " + body.email;
    });
  </script>
</body>
</html>`;

const ERROR_PAGE = `<!doctype html>
<html><head><title>Error Page</title></head>
<body><h1>Broken</h1>
<script>setTimeout(() => { throw new TypeError("fixture uncaught error"); }, 0);</script>
</body></html>`;

export interface FixtureServer {
  url: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(HOME);
      return;
    }
    if (url.pathname === "/error") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(ERROR_PAGE);
      return;
    }
    if (url.pathname === "/api/data") {
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": `session=${FIXTURE_SECRETS.cookie}; Path=/; HttpOnly`,
      });
      res.end(JSON.stringify({ items: [1, 2, 3], token: FIXTURE_SECRETS.responseToken }));
      return;
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
      req.on("end", () => {
        const { email } = JSON.parse(raw) as { email: string };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ email }));
      });
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
