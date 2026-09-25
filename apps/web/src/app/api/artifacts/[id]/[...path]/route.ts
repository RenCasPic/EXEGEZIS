import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { findInvestigation } from "@/lib/evidence/investigations";
import { isInside } from "@/lib/workspace";

/**
 * Serves one file of an investigation directory, read-only. The id is
 * resolved through the discovery index and the path must stay inside that
 * directory. Captured DOM is untrusted page content: it is served under a
 * CSP sandbox with no scripts, and only ever rendered in a sandboxed iframe.
 */
const TYPES: Record<string, { type: string; download?: boolean }> = {
  ".png": { type: "image/png" },
  ".jpg": { type: "image/jpeg" },
  ".json": { type: "application/json; charset=utf-8" },
  ".jsonl": { type: "text/plain; charset=utf-8" },
  ".html": { type: "text/html; charset=utf-8" },
  ".ts": { type: "text/plain; charset=utf-8" },
  ".log": { type: "text/plain; charset=utf-8" },
  ".zip": { type: "application/zip", download: true },
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = await params;
  const ref = await findInvestigation(id);
  if (ref === null) return new Response("Not found", { status: 404 });
  const file = join(ref.dir, ...path.map((p) => decodeURIComponent(p)));
  const kind = TYPES[extname(file).toLowerCase()];
  if (!isInside(ref.dir, file) || kind === undefined) return new Response("Not found", { status: 404 });
  try {
    if (!(await stat(file)).isFile()) return new Response("Not found", { status: 404 });
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const body = await readFile(file);
  const source = new URL(request.url).searchParams.get("source") === "1";
  const headers = new Headers({
    "Content-Type": source ? "text/plain; charset=utf-8" : kind.type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
  });
  if (kind.download === true) headers.set("Content-Disposition", `attachment; filename="${path.at(-1) ?? "artifact"}"`);
  return new Response(new Uint8Array(body), { headers });
}
