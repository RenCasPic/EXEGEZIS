// Screenshots of the public site (docs/screenshots/site/): the whole landing page in English
// and Spanish at 1440 and 375 px, plus the Open Graph images (public/og-{en,es}.png, 1200×630,
// the navy hero). It also checks that no page scrolls sideways at 375 px.
//
//   node apps/site/scripts/screenshots.mjs            (from the repository folder)
//
// It starts its own `next dev` on a free port with its own build folder (.next-shots), unless
// SITE_URL points at a running site.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";

const SITE = join(import.meta.dirname, "..");
const REPO = join(SITE, "..", "..");
const OUT = join(REPO, "docs", "screenshots", "site");

let base = process.env.SITE_URL?.replace(/\/+$/, "") ?? null;
let server = null;
if (base === null) {
  const port = await new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(SITE, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: SITE,
    env: { ...process.env, EXEGEZIS_NEXT_DIST: ".next-shots", NEXT_TELEMETRY_DISABLED: "1", EXEGEZIS_MODE: "local", NEXT_PUBLIC_EXEGEZIS_MODE: "local" },
    stdio: "ignore",
    windowsHide: true,
  });
}
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/en/`)).status < 500) break;
  } catch {}
  if (i > 480) throw new Error("the site did not start");
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch();
try {
  mkdirSync(OUT, { recursive: true });
  const overflow = [];
  for (const locale of ["en", "es"]) {
    for (const width of [1440, 375]) {
      const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 900 }, deviceScaleFactor: 1 });
      await page.goto(`${base}/${locale}/`, { waitUntil: "networkidle", timeout: 180_000 });
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (extra > 0) overflow.push(`${locale} ${width}px: +${extra}px`);
      await page.screenshot({ path: join(OUT, `landing-${locale}-${width}.png`), fullPage: true });
      console.log(`landing-${locale}-${width}.png`);
      if (width === 1440) {
        // Open Graph: the hero, 1200×630.
        const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
        await og.goto(`${base}/${locale}/`, { waitUntil: "networkidle" });
        await og.screenshot({ path: join(SITE, "public", `og-${locale}.png`), clip: { x: 0, y: 0, width: 1200, height: 630 } });
        await og.close();
      }
      await page.close();
    }
  }
  console.log(overflow.length === 0 ? "375 px: no sideways scroll (en, es)" : `sideways scroll:\n${overflow.join("\n")}`);
  if (overflow.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
  if (server !== null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else server.kill("SIGTERM");
  }
}
