import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import postgres from "postgres";

/*
 * A stand-in for Supabase's Data API (PostgREST) and the admin users API of
 * Supabase Auth, for the tests on a machine without Docker. It speaks the part
 * of the HTTP API that @supabase/supabase-js uses in EXEGEZIS — select with
 * filters, order and limit; insert and upsert; update; delete; rpc — on the
 * same Postgres (PGlite through its socket), and, like PostgREST, runs every
 * request as the role of its JWT (anon, authenticated with the user's claims,
 * or service_role), so Row Level Security and the grants apply for real.
 *
 * Tests only. With a real Supabase (EXEGEZIS_TEST_SUPABASE=1) it is not used.
 */

export const STANDIN_JWT_SECRET = "exegezis-standin-jwt-secret-not-for-production";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signJwt(payload: Record<string, unknown>, secret = STANDIN_JWT_SECRET): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token: string): Record<string, unknown> | null {
  const [head, body, sig] = token.split(".");
  if (head === undefined || body === undefined || sig === undefined) return null;
  if (createHmac("sha256", STANDIN_JWT_SECRET).update(`${head}.${body}`).digest("base64url") !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
  if (typeof payload["exp"] === "number" && payload["exp"] < Date.now() / 1000) return null;
  return payload;
}

const longLived = (role: string) => signJwt({ role, iss: "exegezis-standin", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 });

/** The project's keys, as Supabase shows them in Project Settings → API. */
export function standinKeys(): { anonKey: string; serviceRoleKey: string } {
  return { anonKey: longLived("anon"), serviceRoleKey: longLived("service_role") };
}

/** A user's access token, as Supabase Auth would issue it. */
export function userToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ sub: userId, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 });
}

const ROLES = new Set(["anon", "authenticated", "service_role"]);
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (name: string): string => {
  if (!IDENT.test(name)) throw new HttpError(400, "PGRST100", `invalid name: ${name}`);
  return `"${name}"`;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const OPERATORS: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

/** The WHERE clause of the request's filters (col=op.value), with its parameters. */
function filters(url: URL, params: unknown[]): string {
  const parts: string[] = [];
  for (const [key, raw] of url.searchParams) {
    if (RESERVED.has(key)) continue;
    const col = `x.${ident(key)}`;
    const dot = raw.indexOf(".");
    const op = dot < 0 ? raw : raw.slice(0, dot);
    const value = dot < 0 ? "" : raw.slice(dot + 1);
    const sqlOp = OPERATORS[op];
    if (sqlOp !== undefined) {
      params.push(value);
      parts.push(`${col} ${sqlOp} $${params.length}`);
    } else if (op === "is") {
      const v = value.toLowerCase();
      if (v !== "null" && v !== "true" && v !== "false") throw new HttpError(400, "PGRST100", `is.${value}`);
      parts.push(`${col} is ${v}`);
    } else if (op === "in") {
      const list = value.replace(/^\(|\)$/g, "").split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const marks = list.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      parts.push(marks.length === 0 ? "false" : `${col} in (${marks.join(", ")})`);
    } else {
      throw new HttpError(400, "PGRST100", `operator not supported by the stand-in: ${op}`);
    }
  }
  return parts.length === 0 ? "" : `where ${parts.join(" and ")}`;
}

function columns(select: string | null): string {
  const list = (select ?? "*").split(",").map((c) => c.trim().replace(/^"|"$/g, "")).filter((c) => c !== "");
  if (list.length === 0 || list.includes("*")) return "x.*";
  return list.map((c) => `x.${ident(c)}`).join(", ");
}

function order(url: URL): string {
  const raw = url.searchParams.get("order");
  if (raw === null || raw === "") return "";
  return `order by ${raw
    .split(",")
    .map((part) => {
      const [col = "", dir = "asc", nulls] = part.split(".");
      const d = dir === "desc" ? "desc" : "asc";
      return `x.${ident(col)} ${d}${nulls === "nullsfirst" ? " nulls first" : nulls === "nullslast" ? " nulls last" : ""}`;
    })
    .join(", ")}`;
}

function limit(url: URL): string {
  const l = url.searchParams.get("limit");
  const o = url.searchParams.get("offset");
  return `${l !== null && /^\d+$/.test(l) ? `limit ${l}` : ""} ${o !== null && /^\d+$/.test(o) ? `offset ${o}` : ""}`.trim();
}

async function readBody(req: IncomingMessage): Promise<string> {
  let raw = "";
  for await (const chunk of req) raw += String(chunk);
  return raw;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function pgError(error: unknown, role: string): HttpError {
  const e = error as { code?: string; message?: string };
  const code = e.code ?? "XX000";
  const status = code === "42501" ? (role === "anon" ? 401 : 403) : code === "23505" || code === "23503" ? 409 : code === "42883" || code === "42P01" ? 404 : code.startsWith("22") || code.startsWith("23") ? 400 : 400;
  return new HttpError(status, code, e.message ?? String(error));
}

/**
 * Handles /rest/v1/* and /auth/v1/admin/users*; false for anything else, so
 * the Supabase Auth stand-in can serve the rest of /auth/v1.
 */
export function restHandler(sql: postgres.Sql): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://standin");
    const rest = url.pathname.startsWith("/rest/v1/");
    const admin = url.pathname.startsWith("/auth/v1/admin/users");
    if (!rest && !admin) return false;
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || String(req.headers["apikey"] ?? "");
    const claims = verifyJwt(token);
    const role = typeof claims?.["role"] === "string" ? claims["role"] : "";
    try {
      if (claims === null || !ROLES.has(role)) throw new HttpError(401, "PGRST301", "JWT invalid");
      if (admin) {
        await adminUsers(sql, req, res, url, role);
        return true;
      }
      const raw = await readBody(req);
      const body: unknown = raw === "" ? null : JSON.parse(raw);
      const prefer = String(req.headers["prefer"] ?? "");
      const representation = prefer.includes("return=representation");
      const asObject = String(req.headers["accept"] ?? "").includes("vnd.pgrst.object");
      const name = url.pathname.slice("/rest/v1/".length);

      const result = await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
        if (name.startsWith("rpc/")) {
          const fn = name.slice(4);
          ident(fn);
          const found = await tx.unsafe<{ argnames: string[] | null; argtypes: string; retset: boolean; rettype: string }[]>(
            "select p.proargnames as argnames, oidvectortypes(p.proargtypes) as argtypes, p.proretset as retset, p.prorettype::regtype::text as rettype from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1",
            [fn],
          );
          const f = found[0];
          if (f === undefined) throw new HttpError(404, "PGRST202", `function public.${fn} not found`);
          const types = f.argtypes === "" ? [] : f.argtypes.split(",").map((t) => t.trim());
          const names = (f.argnames ?? []).slice(0, types.length);
          const args = (body ?? {}) as Record<string, unknown>;
          const params: unknown[] = [];
          const call = names
            .filter((n) => n in args)
            .map((n) => {
              const v = args[n];
              params.push(v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));
              return `${ident(n)} => $${params.length}::${types[names.indexOf(n)] ?? "text"}`;
            })
            .join(", ");
          await tx.unsafe(`set local role ${role}`);
          if (f.rettype === "void") {
            await tx.unsafe(`select public.${ident(fn)}(${call})`, params as never[]);
            return { status: 204, body: undefined };
          }
          const rows = await tx.unsafe<{ j: unknown }[]>(f.retset ? `select coalesce(json_agg(r), '[]'::json) as j from public.${ident(fn)}(${call}) r` : `select to_json(public.${ident(fn)}(${call})) as j`, params as never[]);
          return { status: 200, body: rows[0]?.j ?? null };
        }

        const table = `public.${ident(name)}`;
        const params: unknown[] = [];
        await tx.unsafe(`set local role ${role}`);
        if (req.method === "GET" || req.method === "HEAD") {
          const where = filters(url, params);
          const rows = await tx.unsafe<{ j: unknown[] }[]>(`select coalesce(json_agg(t), '[]'::json) as j from (select ${columns(url.searchParams.get("select"))} from ${table} x ${where} ${order(url)} ${limit(url)}) t`, params as never[]);
          return { status: 200, body: rows[0]?.j ?? [] };
        }
        if (req.method === "POST") {
          const list = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
          const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
          const cols = keys.map(ident).join(", ");
          params.push(JSON.stringify(list));
          const target = url.searchParams.get("on_conflict");
          const conflict = prefer.includes("resolution=ignore-duplicates")
            ? `on conflict${target === null ? "" : ` (${target.split(",").map((c) => ident(c.trim())).join(", ")})`} do nothing`
            : prefer.includes("resolution=merge-duplicates")
              ? `on conflict (${(target ?? "id").split(",").map((c) => ident(c.trim())).join(", ")}) do update set ${keys.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`
              : "";
          const insert = `insert into ${table} as x (${cols}) select ${cols} from json_populate_recordset(null::${table}, $1::text::json) ${conflict}`;
          if (!representation) {
            await tx.unsafe(insert, params as never[]);
            return { status: 201, body: undefined };
          }
          const rows = await tx.unsafe<{ j: unknown[] }[]>(`with r as (${insert} returning ${columns(url.searchParams.get("select"))}) select coalesce(json_agg(r), '[]'::json) as j from r`, params as never[]);
          return { status: 201, body: rows[0]?.j ?? [] };
        }
        if (req.method === "PATCH") {
          const patch = (body ?? {}) as Record<string, unknown>;
          params.push(JSON.stringify(patch));
          const set = Object.keys(patch)
            .map((k) => `${ident(k)} = (json_populate_record(null::${table}, $1::text::json)).${ident(k)}`)
            .join(", ");
          const update = `update ${table} x set ${set} ${filters(url, params)}`;
          if (!representation) {
            await tx.unsafe(update, params as never[]);
            return { status: 204, body: undefined };
          }
          const rows = await tx.unsafe<{ j: unknown[] }[]>(`with r as (${update} returning ${columns(url.searchParams.get("select"))}) select coalesce(json_agg(r), '[]'::json) as j from r`, params as never[]);
          return { status: 200, body: rows[0]?.j ?? [] };
        }
        if (req.method === "DELETE") {
          const del = `delete from ${table} x ${filters(url, params)}`;
          if (!representation) {
            await tx.unsafe(del, params as never[]);
            return { status: 204, body: undefined };
          }
          const rows = await tx.unsafe<{ j: unknown[] }[]>(`with r as (${del} returning ${columns(url.searchParams.get("select"))}) select coalesce(json_agg(r), '[]'::json) as j from r`, params as never[]);
          return { status: 200, body: rows[0]?.j ?? [] };
        }
        throw new HttpError(405, "PGRST117", `${req.method ?? ""} not supported`);
      }).catch((error: unknown) => {
        throw error instanceof HttpError ? error : pgError(error, role);
      });

      if (asObject && Array.isArray(result.body)) {
        if (result.body.length !== 1) throw new HttpError(406, "PGRST116", `JSON object requested, multiple (or no) rows returned (${result.body.length})`);
        send(res, result.status, result.body[0]);
      } else {
        send(res, result.status, result.body);
      }
    } catch (error) {
      const e = error instanceof HttpError ? error : new HttpError(500, "XX000", error instanceof Error ? error.message : String(error));
      if (admin) send(res, e.status, { code: e.status, error_code: e.code, msg: e.message });
      else send(res, e.status, { code: e.code, message: e.message, details: null, hint: null });
    }
    return true;
  };
}

/** GET /auth/v1/admin/users (list) and DELETE /auth/v1/admin/users/<id>: the service role only. */
async function adminUsers(sql: postgres.Sql, req: IncomingMessage, res: ServerResponse, url: URL, role: string): Promise<void> {
  if (role !== "service_role") throw new HttpError(403, "not_admin", "User not allowed");
  const id = url.pathname.slice("/auth/v1/admin/users".length).replace(/^\//, "");
  if (req.method === "GET" && id === "") {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const perPage = Math.max(1, Number(url.searchParams.get("per_page") ?? "50") || 50);
    const rows = await sql<{ id: string; email: string; created_at: Date; email_confirmed_at: Date | null; raw_user_meta_data: Record<string, unknown> }[]>`
      select id, email, created_at, email_confirmed_at, raw_user_meta_data from auth.users order by created_at asc, id asc limit ${perPage} offset ${(page - 1) * perPage}`;
    const total = await sql<{ n: number }[]>`select count(*)::int as n from auth.users`;
    const users = rows.map((u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.email_confirmed_at?.toISOString() ?? null, user_metadata: u.raw_user_meta_data, app_metadata: {}, created_at: u.created_at.toISOString() }));
    send(res, 200, { users, aud: "authenticated" }, { "x-total-count": String(total[0]?.n ?? 0) });
    return;
  }
  if (req.method === "DELETE" && /^[0-9a-f-]{36}$/i.test(id)) {
    await sql`delete from auth.users where id = ${id}`;
    send(res, 200, {});
    return;
  }
  throw new HttpError(404, "not_found", `${req.method ?? ""} ${url.pathname}`);
}

/** A Data API stand-in on its own port (the accounts tests; the app's tests serve it with the Auth stand-in). */
export async function startRestStandin(databaseUrl: string): Promise<{ url: string; anonKey: string; serviceRoleKey: string; close(): Promise<void> }> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
  const handle = restHandler(sql);
  const server: Server = createServer((req, res) => {
    void handle(req, res).then((handled) => {
      if (!handled) send(res, 404, { message: "not found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const keys = standinKeys();
  return {
    url: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`,
    ...keys,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await sql.end();
    },
  };
}
