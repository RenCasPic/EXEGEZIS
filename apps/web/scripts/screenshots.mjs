// Design screenshots (docs/08-design-system.md): home, an inspection, a search and an
// investigation, light and dark, at 1440 and 375 px, from the real data in runs/; and the
// sideways-scroll check at 375 px on every page, in both themes.
//
//   node apps/web/scripts/screenshots.mjs            (from the repository folder)
//
// It starts its own app with its own build folder (.next-shots), database and Supabase Auth
// stand-in (test/support/app.ts), so a running `pnpm web` is not touched, and signs in as a
// test user whose runs folder shows the repository's runs/.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { linkRuns, signedInUser, startTestApp } from "../test/support/app.ts";

const WEB = join(import.meta.dirname, "..");
const REPO = join(WEB, "..", "..");
const OUT = join(REPO, "docs", "screenshots");
const LANG = process.env.SHOTS_LANG ?? "es";

const app = await startTestApp({ dist: ".next-shots", log: "shots-server.log" });
const base = app.base;
const browser = await chromium.launch();
const user = await signedInUser(app, browser, { name: "Ana Demo", email: `shots-${Date.now()}@example.com` });
const session = user.storageState.cookies.filter((c) => c.name.startsWith("sb-"));
linkRuns(app, user.id, process.env.EXEGEZIS_RUNS_DIR ?? join(REPO, "runs"));
const cookieHeader = [`EXEGEZIS_LOCALE=${LANG}`, ...session.map((c) => `${c.name}=${c.value}`)].join("; ");

/** The first item a list page links to (the newest one): real data, whatever is in runs/. */
async function firstLink(list, pattern) {
  const html = await (await fetch(`${base}${list}`, { headers: { cookie: cookieHeader } })).text();
  return pattern.exec(html)?.[0] ?? null;
}
const inspection = await firstLink("/inspections", /\/inspections\/[0-9A-Z]{26}/);
const search = await firstLink("/searches", /\/searches\/[0-9A-Z]{26}/);
const investigation = await firstLink("/investigations", /\/investigations\/(?!new)[^"?#]+/);

try {
  mkdirSync(OUT, { recursive: true });
  const shots = [
    ["home", "/"],
    ["inspection", inspection],
    ["search", search],
    ["investigation", investigation],
  ];
  const routes = ["/", "/?modo=buscar", "/overview", "/investigations", "/investigations/new", "/inspections", "/searches", "/verification/reproductions", "/verification/root-causes", "/verification/fixes", "/planner", "/benchmarks", "/projects", "/settings", "/settings/access", "/settings/search", ...shots.map(([, r]) => r).filter(Boolean)];
  const overflow = [];
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 }, colorScheme: theme, deviceScaleFactor: 1 });
      await context.addInitScript((t) => {
        try {
          localStorage.setItem("exegezis-theme", t);
        } catch {}
      }, theme);
      await context.addCookies([{ name: "EXEGEZIS_LOCALE", value: LANG, url: base }, ...session]);
      const page = await context.newPage();
      for (const [name, route] of shots) {
        if (!route) continue;
        await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 180_000 });
        // Full page, up to 3200 px tall (an inspection with hundreds of page writes is far longer).
        const height = Math.min(3200, await page.evaluate(() => document.documentElement.scrollHeight));
        await page.screenshot({ path: join(OUT, `${name}-${width}-${theme}.png`), fullPage: true, clip: { x: 0, y: 0, width, height } });
        console.log(`${name}-${width}-${theme}.png`);
      }
      if (width === 375) {
        for (const route of routes) {
          await page.goto(`${base}${route}`, { waitUntil: "load", timeout: 180_000 });
          const w = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (w > 0) overflow.push(`${theme} ${route}: +${w}px`);
        }
      }
      await context.close();
    }
  }
  console.log(overflow.length === 0 ? "375 px: no page scrolls sideways (light and dark)" : `375 px overflow:\n${overflow.join("\n")}`);
  if (overflow.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
  await app.stop();
}
