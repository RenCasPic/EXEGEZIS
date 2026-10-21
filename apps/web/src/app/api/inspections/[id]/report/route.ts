import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUiLocale } from "@/i18n/server";
import { isLocale } from "@/i18n/locales";
import { runCli } from "@/lib/access";
import { say } from "@/lib/action-errors";
import { findInspection } from "@/lib/evidence/inspections";
import { ownerReportHtml } from "@/lib/owner-report";
import { ui } from "@/lib/ui-message";

/**
 * The owner's report of an inspection, as a PDF, in Spanish or English
 * (?lang=es|en; the reader's language by default). Composed here (lib/owner-report.ts)
 * and printed by the CLI (`exegezis pdf`): no browser runs inside the web server.
 * ?format=html returns the document itself (what the PDF prints).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Only the user's own inspections are found (their workspace).
  const ref = await findInspection(id);
  if (ref === null || ref.report.status !== "ok") return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const asked = url.searchParams.get("lang");
  const locale = isLocale(asked) ? asked : await getUiLocale();
  const report = ref.report.value;
  const html = await ownerReportHtml({ report, dir: ref.dir, id: ref.id, locale });
  const host = new URL(report.target.url).host.replace(/[^\w.-]/g, "_");
  const name = `${locale === "es" ? "informe" : "report"}-${host}-${report.finishedAt.slice(0, 10)}`;
  if (url.searchParams.get("format") === "html") {
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'" } });
  }
  const dir = await mkdtemp(join(tmpdir(), "exegezis-report-"));
  try {
    const source = join(dir, "report.html");
    const out = join(dir, `${name}.pdf`);
    await writeFile(source, html, "utf8");
    const r = await runCli(["--lang", locale, "pdf", "--html", source, "--output", out]);
    if (r.code !== 0) return new Response(await say(ui("common.errors.pdfFailed", { detail: r.stderr.trim() || r.stdout.trim() })), { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const pdf = await readFile(out);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}.pdf"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
