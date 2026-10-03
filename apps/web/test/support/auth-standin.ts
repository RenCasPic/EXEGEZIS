import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import postgres from "postgres";

/*
 * A stand-in for Supabase Auth (GoTrue), for the cloud-mode tests on a
 * machine without Docker. It speaks the part of the GoTrue HTTP API the app
 * uses through @supabase/ssr — sign-up with email confirmation, PKCE codes,
 * password and refresh grants, the user, logout (local and global), password
 * recovery, resend, OAuth (simulated provider) and identities — and keeps the
 * users in auth.users of the same Postgres the app uses (through the socket,
 * never in-process: PGlite is one session). The emails it would send are kept
 * in a mailbox (GET /mailbox), like Mailpit does with a real `supabase start`.
 *
 * Tests only. With a real Supabase (EXEGEZIS_TEST_SUPABASE=1) it is not used.
 */

export const STANDIN_JWT_SECRET = "exegezis-standin-jwt-secret-not-for-production";

export interface Mail {
  to: string;
  type: "signup" | "recovery" | "email_change";
  link: string;
  at: number;
}

interface Session {
  id: string;
  userId: string;
  refreshToken: string;
  revoked: boolean;
}

interface Flow {
  userId: string;
  challenge: string | null;
  type: string;
}

interface UserRow {
  id: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: Date | null;
  raw_user_meta_data: Record<string, unknown>;
  raw_app_meta_data: Record<string, unknown>;
  last_sign_in_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signJwt(payload: Record<string, unknown>, secret = STANDIN_JWT_SECRET): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verifyJwt(token: string): Record<string, unknown> | null {
  const [head, body, sig] = token.split(".");
  if (head === undefined || body === undefined || sig === undefined) return null;
  if (createHmac("sha256", STANDIN_JWT_SECRET).update(`${head}.${body}`).digest("base64url") !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
  if (typeof payload["exp"] === "number" && payload["exp"] < Date.now() / 1000) return null;
  return payload;
}

const hash = (password: string) => `standin$${createHash("sha256").update(password).digest("hex")}`;

export interface AuthStandin {
  url: string;
  anonKey: string;
  mailbox: Mail[];
  /** The latest mail to `email` of `type` (waits for it a little). */
  lastMail(email: string, type: Mail["type"]): Promise<Mail>;
  /** The simulated OAuth provider signs in this person next. */
  oauthAs(person: { email: string; name: string; provider: "github" | "google" }): void;
  close(): Promise<void>;
}

export async function startAuthStandin(databaseUrl: string): Promise<AuthStandin> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
  const sessions = new Map<string, Session>();
  const flows = new Map<string, Flow>();
  const tokens = new Map<string, { userId: string; type: string; challenge: string | null; redirectTo: string; email?: string }>();
  const mailbox: Mail[] = [];
  let oauthPerson = { email: "oauth@example.test", name: "OAuth Person", provider: "github" as "github" | "google" };
  let base = "";

  async function findUser(by: { id?: string; email?: string }): Promise<UserRow | null> {
    const rows =
      by.id !== undefined
        ? await sql<UserRow[]>`select * from auth.users where id = ${by.id}`
        : await sql<UserRow[]>`select * from auth.users where lower(email) = lower(${by.email ?? ""})`;
    return rows[0] ?? null;
  }

  async function identities(user: UserRow) {
    const rows = await sql<{ id: string; provider: string; provider_id: string; identity_data: Record<string, unknown>; created_at: Date }[]>`select * from auth.identities where user_id = ${user.id} order by created_at`;
    return rows.map((r) => ({
      id: r.id,
      identity_id: r.id,
      user_id: user.id,
      provider: r.provider,
      identity_data: { sub: r.provider_id, email: user.email, ...r.identity_data },
      created_at: r.created_at.toISOString(),
      updated_at: r.created_at.toISOString(),
      last_sign_in_at: r.created_at.toISOString(),
    }));
  }

  async function userJson(user: UserRow) {
    const ids = await identities(user);
    return {
      id: user.id,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      email_confirmed_at: user.email_confirmed_at?.toISOString() ?? null,
      confirmed_at: user.email_confirmed_at?.toISOString() ?? null,
      last_sign_in_at: user.last_sign_in_at?.toISOString() ?? null,
      app_metadata: { provider: ids[0]?.provider ?? "email", providers: [...new Set(ids.map((i) => i.provider))] },
      user_metadata: user.raw_user_meta_data,
      identities: ids,
      created_at: user.created_at.toISOString(),
      updated_at: user.updated_at.toISOString(),
      is_anonymous: false,
    };
  }

  async function newSession(user: UserRow) {
    const id = randomUUID();
    const refreshToken = randomBytes(24).toString("hex");
    sessions.set(refreshToken, { id, userId: user.id, refreshToken, revoked: false });
    await sql`update auth.users set last_sign_in_at = now() where id = ${user.id}`;
    const now = Math.floor(Date.now() / 1000);
    const accessToken = signJwt({ sub: user.id, aud: "authenticated", role: "authenticated", email: user.email, session_id: id, iat: now, exp: now + 3600, aal: "aal1", amr: [{ method: "password", timestamp: now }], is_anonymous: false });
    return { access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refreshToken, user: await userJson((await findUser({ id: user.id })) ?? user) };
  }

  function sessionOf(req: IncomingMessage): { session: Session; userId: string } | null {
    const auth = req.headers.authorization ?? "";
    const claims = verifyJwt(auth.replace(/^Bearer\s+/i, ""));
    if (claims === null || typeof claims["sub"] !== "string" || typeof claims["session_id"] !== "string") return null;
    const session = [...sessions.values()].find((s) => s.id === claims["session_id"]);
    if (session === undefined || session.revoked) return null;
    return { session, userId: claims["sub"] };
  }

  function mail(to: string, type: Mail["type"], token: string, redirectTo: string): void {
    const link = `${base}/auth/v1/verify?token=${token}&type=${type}&redirect_to=${encodeURIComponent(redirectTo)}`;
    mailbox.push({ to: to.toLowerCase(), type, link, at: Date.now() });
  }

  function codeFor(userId: string, challenge: string | null, type: string): string {
    const code = randomUUID();
    flows.set(code, { userId, challenge, type });
    return code;
  }

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  const fail = (res: ServerResponse, status: number, code: string, msg: string) => send(res, status, { code: status, error_code: code, msg });
  const redirect = (res: ServerResponse, to: string) => {
    res.writeHead(303, { location: to });
    res.end();
  };
  const withCode = (target: string, code: string) => `${target}${target.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`;

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    try {
      return raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
    } catch {
      return {};
    }
  }

  const text = (v: unknown) => (typeof v === "string" ? v : "");

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", base);
      const path = url.pathname.replace(/^\/auth\/v1/, "");
      const redirectTo = url.searchParams.get("redirect_to") ?? "";
      try {
        if (url.pathname === "/mailbox") return send(res, 200, mailbox);
        if (req.method === "GET" && path === "/settings") return send(res, 200, { external: { email: true, github: true, google: true }, mailer_autoconfirm: false });

        if (req.method === "POST" && path === "/signup") {
          const b = await body(req);
          const email = text(b["email"]).toLowerCase();
          const password = text(b["password"]);
          if ([...password].length < 10) return fail(res, 422, "weak_password", "Password should be at least 10 characters.");
          const existing = await findUser({ email });
          if (existing !== null) {
            // As GoTrue with email confirmation: an obfuscated user, no error, no email.
            return send(res, 200, { id: randomUUID(), aud: "authenticated", role: "", email, identities: [], user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() });
          }
          const meta = (b["data"] ?? {}) as Record<string, unknown>;
          const rows = await sql<UserRow[]>`insert into auth.users (email, encrypted_password, raw_user_meta_data, raw_app_meta_data) values (${email}, ${hash(password)}, ${sql.json(meta as never)}, ${sql.json({ provider: "email", providers: ["email"] })}) returning *`;
          const user = rows[0] as UserRow;
          await sql`insert into auth.identities (user_id, provider, provider_id, identity_data) values (${user.id}, 'email', ${user.id}, ${sql.json({ email })})`;
          const token = randomBytes(16).toString("hex");
          tokens.set(token, { userId: user.id, type: "signup", challenge: text(b["code_challenge"]) || null, redirectTo });
          mail(email, "signup", token, redirectTo);
          return send(res, 200, await userJson(user));
        }

        if (req.method === "POST" && path === "/resend") {
          const b = await body(req);
          const user = await findUser({ email: text(b["email"]) });
          if (user !== null && user.email_confirmed_at === null) {
            const token = randomBytes(16).toString("hex");
            tokens.set(token, { userId: user.id, type: "signup", challenge: text(b["code_challenge"]) || null, redirectTo });
            mail(user.email, "signup", token, redirectTo);
          }
          return send(res, 200, {});
        }

        if (req.method === "POST" && path === "/recover") {
          const b = await body(req);
          const user = await findUser({ email: text(b["email"]) });
          if (user !== null) {
            const token = randomBytes(16).toString("hex");
            tokens.set(token, { userId: user.id, type: "recovery", challenge: text(b["code_challenge"]) || null, redirectTo });
            mail(user.email, "recovery", token, redirectTo);
          }
          return send(res, 200, {});
        }

        if (req.method === "GET" && path === "/verify") {
          const t = tokens.get(url.searchParams.get("token") ?? "");
          const target = redirectTo || t?.redirectTo || base;
          if (t === undefined) return redirect(res, `${target}#error=access_denied&error_code=otp_expired`);
          tokens.delete(url.searchParams.get("token") ?? "");
          if (t.type === "signup") await sql`update auth.users set email_confirmed_at = now() where id = ${t.userId}`;
          if (t.type === "email_change" && t.email !== undefined) await sql`update auth.users set email = ${t.email}, email_confirmed_at = now() where id = ${t.userId}`;
          return redirect(res, withCode(target, codeFor(t.userId, t.challenge, t.type)));
        }

        if (req.method === "GET" && path === "/authorize") {
          // The simulated provider: whoever oauthAs() named signs in (or links to the user of link_user).
          const provider = url.searchParams.get("provider") ?? "github";
          const challenge = url.searchParams.get("code_challenge");
          const linkUser = url.searchParams.get("link_user");
          let user = linkUser === null ? await findUser({ email: oauthPerson.email }) : await findUser({ id: linkUser });
          if (user === null) {
            const rows = await sql<UserRow[]>`insert into auth.users (email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) values (${oauthPerson.email}, now(), ${sql.json({ full_name: oauthPerson.name, avatar_url: null })}, ${sql.json({ provider, providers: [provider] })}) returning *`;
            user = rows[0] as UserRow;
          }
          await sql`insert into auth.identities (user_id, provider, provider_id, identity_data) values (${user.id}, ${provider}, ${`${provider}-${user.email}`}, ${sql.json({ email: user.email })}) on conflict (provider, provider_id) do nothing`;
          return redirect(res, withCode(redirectTo || base, codeFor(user.id, challenge, "oauth")));
        }

        if (req.method === "POST" && path === "/token") {
          const grant = url.searchParams.get("grant_type");
          const b = await body(req);
          if (grant === "password") {
            const user = await findUser({ email: text(b["email"]) });
            if (user === null || user.encrypted_password !== hash(text(b["password"]))) return fail(res, 400, "invalid_credentials", "Invalid login credentials");
            if (user.email_confirmed_at === null) return fail(res, 400, "email_not_confirmed", "Email not confirmed");
            return send(res, 200, await newSession(user));
          }
          if (grant === "pkce") {
            const flow = flows.get(text(b["auth_code"]));
            if (flow === undefined) return fail(res, 404, "flow_state_not_found", "invalid flow state, no valid flow state found");
            flows.delete(text(b["auth_code"]));
            if (flow.challenge !== null && b64url(createHash("sha256").update(text(b["code_verifier"])).digest()) !== flow.challenge) return fail(res, 400, "bad_code_verifier", "code challenge does not match previously saved code verifier");
            const user = await findUser({ id: flow.userId });
            if (user === null) return fail(res, 404, "user_not_found", "User not found");
            return send(res, 200, await newSession(user));
          }
          if (grant === "refresh_token") {
            const s = sessions.get(text(b["refresh_token"]));
            if (s === undefined || s.revoked) return fail(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
            const user = await findUser({ id: s.userId });
            if (user === null) return fail(res, 404, "user_not_found", "User not found");
            s.revoked = true;
            return send(res, 200, await newSession(user));
          }
          return fail(res, 400, "unsupported_grant_type", "unsupported grant type");
        }

        if (path === "/user" && (req.method === "GET" || req.method === "PUT")) {
          const auth = sessionOf(req);
          if (auth === null) return fail(res, 403, "session_not_found", "Session from session_id claim in JWT does not exist");
          let user = await findUser({ id: auth.userId });
          if (user === null) return fail(res, 404, "user_not_found", "User from sub claim in JWT does not exist");
          if (req.method === "PUT") {
            const b = await body(req);
            if (typeof b["password"] === "string") {
              if ([...b["password"]].length < 10) return fail(res, 422, "weak_password", "Password should be at least 10 characters.");
              if (user.encrypted_password === hash(b["password"])) return fail(res, 422, "same_password", "New password should be different from the old password.");
              await sql`update auth.users set encrypted_password = ${hash(b["password"])}, updated_at = now() where id = ${user.id}`;
            }
            if (typeof b["email"] === "string" && b["email"] !== user.email) {
              const token = randomBytes(16).toString("hex");
              tokens.set(token, { userId: user.id, type: "email_change", challenge: text(b["code_challenge"]) || null, redirectTo, email: b["email"].toLowerCase() });
              mail(b["email"], "email_change", token, redirectTo);
            }
            if (typeof b["data"] === "object" && b["data"] !== null) await sql`update auth.users set raw_user_meta_data = raw_user_meta_data || ${sql.json(b["data"] as never)} where id = ${user.id}`;
            const updated = await findUser({ id: user.id });
            if (updated === null) return fail(res, 404, "user_not_found", "User not found");
            user = updated;
          }
          return send(res, 200, await userJson(user));
        }

        if (req.method === "GET" && path === "/user/identities/authorize") {
          const auth = sessionOf(req);
          if (auth === null) return fail(res, 403, "session_not_found", "no session");
          const q = new URLSearchParams({ provider: url.searchParams.get("provider") ?? "github", redirect_to: redirectTo, link_user: auth.userId });
          const challenge = url.searchParams.get("code_challenge");
          if (challenge !== null) q.set("code_challenge", challenge);
          return send(res, 200, { url: `${base}/auth/v1/authorize?${q.toString()}` });
        }

        const unlink = /^\/user\/identities\/([0-9a-f-]+)$/.exec(path);
        if (req.method === "DELETE" && unlink !== null) {
          const auth = sessionOf(req);
          if (auth === null) return fail(res, 403, "session_not_found", "no session");
          await sql`delete from auth.identities where id = ${unlink[1] ?? ""} and user_id = ${auth.userId}`;
          return send(res, 200, {});
        }

        if (req.method === "POST" && path === "/logout") {
          const auth = sessionOf(req);
          if (auth !== null) {
            const scope = url.searchParams.get("scope") ?? "global";
            for (const s of sessions.values()) {
              if (scope === "local" ? s.id === auth.session.id : scope === "others" ? s.userId === auth.userId && s.id !== auth.session.id : s.userId === auth.userId) s.revoked = true;
            }
          }
          res.writeHead(204);
          return res.end();
        }

        return fail(res, 404, "not_found", `${req.method ?? ""} ${path}`);
      } catch (error) {
        return fail(res, 500, "unexpected_failure", error instanceof Error ? error.message : String(error));
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  const anonKey = signJwt({ role: "anon", iss: "exegezis-standin", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 });

  return {
    url: base,
    anonKey,
    mailbox,
    async lastMail(email, type) {
      for (let i = 0; i < 50; i++) {
        const found = [...mailbox].reverse().find((m) => m.to === email.toLowerCase() && m.type === type);
        if (found !== undefined) return found;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`no ${type} mail for ${email}`);
    },
    oauthAs(person) {
      oauthPerson = person;
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await sql.end();
    },
  };
}
