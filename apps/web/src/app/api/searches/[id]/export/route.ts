import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReview, toCsv } from "@exegezis/search/light";
import { runCli } from "@/lib/access";
import { findSearch } from "@/lib/evidence/searches";

/**
 * Exports of a search (docs/10-search.md §5). CSV: UTF-8 with BOM, «;» by
 * default (a Spanish Excel opens it with its accents). PDF: printed by the
 * CLI with the same Chromium the searches use.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ref = await findSearch(id);
  if (ref === null || ref.report.status !== "ok") return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const name = `busqueda-${ref.id}`;
  if (format === "csv") {
    const sep = url.searchParams.get("sep") === "," ? "," : url.searchParams.get("sep") === "tab" ? "\t" : ";";
    const body = toCsv(ref.report.value, await readReview(ref.dir), sep);
    return new Response(body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  const dir = await mkdtemp(join(tmpdir(), "exegezis-pdf-"));
  try {
    const out = join(dir, `${name}.pdf`);
    const r = await runCli(["search", "export", "--search", ref.dir, "--format", "pdf", "--out", out]);
    if (r.code !== 0) return new Response(`No se pudo generar el PDF: ${r.stderr.trim() || r.stdout.trim()}`, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const pdf = await readFile(out);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
