// Design screenshots (docs/08-design-system.md): home, an inspection, a search and an
// investigation, light and dark, at 1440 and 375 px, from the real data in runs/; and the
// sideways-scroll check at 375 px on every page, in both themes.
//
//   node apps/web/scripts/screenshots.mjs            (from the repository folder)
//
// It starts its own `next dev` on a free port with its own build folder (.next-shots),
// so a running `pnpm web` is not touched.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright";

const WEB = join(import.meta.dirname, "..");
const REPO = join(WEB, "..", "..");
const OUT = join(REPO, "docs", "screenshots");
const LANG = process.env.SHOTS_LANG ?? "es";

const port = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(WEB, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: WEB,
  env: { ...process.env, EXEGEZIS_NEXT_DIST: ".next-shots", NEXT_TELEMETRY_DISABLED: "1", EXEGEZIS_MODE: "local", NEXT_PUBLIC_EXEGEZIS_MODE: "local" },
  stdio: "ignore",
  windowsHide: true,
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/`)).status < 500) break;
  } catch {}
  if (i > 480) throw new Error("the UI server did not start");
  await new Promise((r) => setTimeout(r, 500));
}

/** The first item a list page links to (the newest one): real data, whatever is in runs/. */
async function firstLink(list, pattern) {
  const html = await (await fetch(`${base}${list}`, { headers: { cookie: `EXEGEZIS_LOCALE=${LANG}` } })).text();
  return pattern.exec(html)?.[0] ?? null;
}
const inspection = await firstLink("/inspections", /\/inspections\/[0-9A-Z]{26}/);
const search = await firstLink("/searches", /\/searches\/[0-9A-Z]{26}/);
const investigation = await firstLink("/investigations", /\/investigations\/(?!new)[^"?#]+/);

const browser = await chromium.launch();
const stop = () => {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
};
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
      await context.addCookies([{ name: "EXEGEZIS_LOCALE", value: LANG, url: base }]);
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
  stop();
}
