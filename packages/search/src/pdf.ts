import { launchBrowser, type BrowserChannel } from "@exegezis/adapter-browser";

/** Prints a standalone HTML page to PDF with the same browser the searches use (no new dependency). */
export async function htmlToPdf(html: string, path: string, channel: BrowserChannel = "auto"): Promise<void> {
  const { browser } = await launchBrowser({ channel, headless: true });
  try {
    const page = await browser.newPage();
    // The HTML is ours (escaped report data); it loads nothing from the network.
    await page.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path, format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" } });
  } finally {
    await browser.close();
  }
}
