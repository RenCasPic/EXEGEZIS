// Screenshots of the public pages (docs/screenshots/site/): the whole landing (/product, /producto)
// at 1440 and 375 px, plus the Open Graph images (public/og-{en,es}.png, 1200×630,
// the navy hero). It also checks that no page scrolls sideways at 375 px.
//
//   node apps/web/scripts/site-screenshots.mjs        (from the repository folder)
//
// It starts its own app with its own build folder (.next-shots), database and Supabase Auth
// stand-in (test/support/app.ts), so a running `pnpm web` is not touched.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { startTestApp } from "../test/support/app.ts";

const SITE = join(import.meta.dirname, "..");
const PATH = { en: "/product", es: "/producto" };
const REPO = join(SITE, "..", "..");
const OUT = join(REPO, "docs", "screenshots", "site");

const app = await startTestApp({ dist: ".next-shots", log: "shots-server.log" });
const base = app.base;

const browser = await chromium.launch();
try {
  mkdirSync(OUT, { recursive: true });
  const overflow = [];
  for (const locale of ["en", "es"]) {
    for (const width of [1440, 375]) {
      const page = await browser.newPage({ viewport: { width, height: width === 375 ? 812 : 900 }, deviceScaleFactor: 1 });
      await page.goto(`${base}${PATH[locale]}`, { waitUntil: "networkidle", timeout: 180_000 });
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (extra > 0) overflow.push(`${locale} ${width}px: +${extra}px`);
      await page.screenshot({ path: join(OUT, `landing-${locale}-${width}.png`), fullPage: true });
      console.log(`landing-${locale}-${width}.png`);
      if (width === 1440) {
        // Open Graph: the hero, 1200×630.
        const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
        await og.goto(`${base}${PATH[locale]}`, { waitUntil: "networkidle" });
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
  await app.stop();
}
