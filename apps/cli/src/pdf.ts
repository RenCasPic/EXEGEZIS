import { readFile } from "node:fs/promises";
import { launchBrowser } from "@exegezis/adapter-browser";
import { isEngineUnavailable } from "@exegezis/core";
import { EXIT } from "./args.js";
import { printEngineError } from "./doctor.js";
import { t } from "./i18n.js";
import { printer, type CliIo } from "./shared.js";

/**
 * `exegezis pdf --html <file> --output <file.pdf>`: prints a self-contained
 * HTML document to a tagged PDF (headings as an outline) with the browser
 * EXEGEZIS already drives. The owner report of the web app uses it, so that no
 * browser runs inside the web server. JavaScript is off and every request is
 * refused: whatever the PDF shows has to be inside the HTML (images as data: URLs).
 */
export async function pdfCommand(command: { html: string; output: string }, io: CliIo): Promise<number> {
  const print = printer(io);
  const html = await readFile(command.html, "utf8");
  let launched;
  try {
    launched = await launchBrowser({ channel: "auto", headless: true });
  } catch (error) {
    if (isEngineUnavailable(error)) {
      printEngineError(io, error.toInfo());
      return EXIT.engineError;
    }
    throw error;
  }
  try {
    const context = await launched.browser.newContext({ javaScriptEnabled: false });
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: command.output, format: "A4", printBackground: true, tagged: true, outline: true, margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" } });
    print(t("pdf.written", { file: command.output }));
    return EXIT.ok;
  } finally {
    await launched.browser.close().catch(() => undefined);
  }
}
