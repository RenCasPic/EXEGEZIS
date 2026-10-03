// Compares the landing (apps/site) and the app home (apps/web) with the design references in
// docs/design/ and writes the captures and the differences to docs/design/diff/.
//
//   pnpm design:compare                       (from the repository folder)
//
// For each page it saves:
//   <name>.actual.png      the implementation, full page;
//   <name>.reference.png   the reference HTML rendered here, with the same local Geist fonts;
//   <name>.diff.png        actual vs reference HTML: the reference faded, the differences in red;
//   <name>.png-diff.png    actual vs the committed reference PNG (captured without Geist, so its
//                          line breaks differ: informative only);
// and report.md with the share of different pixels. The references are rendered at their
// natural height (see unsqueeze).
//
// It starts its own `next dev` for each app (build folder .next-shots), unless SITE_URL or
// WEB_URL point to one that is already running. DESIGN_ONLY=landing,home-app limits the pages. The app home shows the real data in runs/.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const REPO = join(import.meta.dirname, "..");
const DESIGN = join(REPO, "docs", "design");
const OUT = join(DESIGN, "diff");
const FONTS = join(REPO, "apps", "site", "node_modules", "geist", "dist", "fonts");

/** A channel difference above this counts (antialiasing stays below it on flat colours). */
const THRESHOLD = 48;

const TARGETS = [
  { name: "landing", app: "site", path: "/es/", width: 1440, reference: "landing.html", png: "landing.png" },
  { name: "home-app", app: "web", path: "/", width: 1440, theme: "light", reference: "home-app.html", png: "home-app.png" },
  { name: "home-app-dark", app: "web", path: "/", width: 1440, theme: "dark", reference: "home-app.html", click: '[aria-label="Tema oscuro"]' },
  { name: "home-app-mobile", app: "web", path: "/", width: 390, theme: "light", reference: "home-app-mobile.html", png: "home-app-mobile.png" },
  { name: "home-app-mobile-dark", app: "web", path: "/", width: 390, theme: "dark", reference: "home-app-mobile.html", click: '[aria-label="Cambiar a tema oscuro"]' },
];

function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const servers = [];
async function startApp(app) {
  const given = app === "site" ? process.env.SITE_URL : process.env.WEB_URL;
  if (given) return given.replace(/\/+$/, "");
  const dir = join(REPO, "apps", app);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [join(dir, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: dir,
    env: { ...process.env, EXEGEZIS_NEXT_DIST: ".next-shots", NEXT_TELEMETRY_DISABLED: "1", EXEGEZIS_MODE: "local", NEXT_PUBLIC_EXEGEZIS_MODE: "local" },
    stdio: "ignore",
    windowsHide: true,
  });
  servers.push(server);
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}${app === "site" ? "/es/" : "/"}`)).status < 500) break;
    } catch {}
    if (i > 480) throw new Error(`apps/${app} did not start`);
    await new Promise((r) => setTimeout(r, 500));
  }
  return base;
}

/** The references load Geist from Google Fonts: serve the same local files the apps use instead. */
async function localFonts(page) {
  const files = {
    "/geist.woff2": join(FONTS, "geist-sans", "Geist-Variable.woff2"),
    "/geist-mono.woff2": join(FONTS, "geist-mono", "GeistMono-Variable.woff2"),
  };
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({
      contentType: "text/css",
      body: `@font-face{font-family:'Geist';src:url(https://fonts.gstatic.com/geist.woff2) format('woff2');font-weight:100 900}
@font-face{font-family:'Geist Mono';src:url(https://fonts.gstatic.com/geist-mono.woff2) format('woff2');font-weight:100 900}`,
    }),
  );
  await page.route("https://fonts.gstatic.com/**", (route) => {
    const file = files[new URL(route.request().url()).pathname];
    return file ? route.fulfill({ contentType: "font/woff2", body: readFileSync(file) }) : route.abort();
  });
}

/**
 * The references give their root a fixed height smaller than their content, so the browser
 * shrinks the flex items that can shrink (the app home's 64 px header becomes 38 px, as in
 * home-app.png). Render them at their natural height, as designed.
 */
async function unsqueeze(page) {
  await page.addStyleTag({ content: "#root > * { height: auto !important; min-height: 0 !important; }" });
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** Pixel difference of two PNGs, computed in the browser (no image library needed). */
async function diff(page, a, b) {
  return page.evaluate(
    async ({ a, b, threshold }) => {
      const load = (b64) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = `data:image/png;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const pixels = (img) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ff00ff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const pa = pixels(ia);
      const pb = pixels(ib);
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const octx = out.getContext("2d");
      const od = octx.createImageData(w, h);
      let different = 0;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
        if (d > threshold) {
          different++;
          od.data[i] = 230;
          od.data[i + 1] = 30;
          od.data[i + 2] = 30;
        } else {
          // The reference, faded towards white.
          const y = 0.299 * pb[i] + 0.587 * pb[i + 1] + 0.114 * pb[i + 2];
          const v = 255 - (255 - y) * 0.15;
          od.data[i] = od.data[i + 1] = od.data[i + 2] = v;
        }
        od.data[i + 3] = 255;
      }
      octx.putImageData(od, 0, 0);
      return { png: out.toDataURL("image/png").split(",")[1], different, total: w * h, size: [ia.width, ia.height, ib.width, ib.height] };
    },
    { a, b, threshold: THRESHOLD },
  );
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const bases = {};
const rows = [];
try {
  const scratch = await (await browser.newContext()).newPage();
  const only = process.env.DESIGN_ONLY?.split(",");
  for (const target of TARGETS.filter((t) => only === undefined || only.includes(t.name))) {
    bases[target.app] ??= await startApp(target.app);
    const viewport = { width: target.width, height: 900 };

    // The implementation.
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: target.theme ?? "light", locale: "es-ES" });
    if (target.app === "web") {
      await ctx.addInitScript((t) => {
        try {
          localStorage.setItem("exegezis-theme", t);
        } catch {}
      }, target.theme);
      await ctx.addCookies([{ name: "EXEGEZIS_LOCALE", value: "es", url: bases.web }]);
    }
    const page = await ctx.newPage();
    await page.goto(`${bases[target.app]}${target.path}`, { waitUntil: "networkidle", timeout: 300_000 });
    await settle(page);
    const actual = await page.screenshot({ fullPage: true });
    writeFileSync(join(OUT, `${target.name}.actual.png`), actual);
    await ctx.close();

    // The reference HTML, with the same fonts.
    const rctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const ref = await rctx.newPage();
    await localFonts(ref);
    await ref.goto(pathToFileURL(join(DESIGN, target.reference)).href, { waitUntil: "load" });
    if (target.click) await ref.click(target.click);
    await unsqueeze(ref);
    await settle(ref);
    const reference = await ref.screenshot({ fullPage: true });
    writeFileSync(join(OUT, `${target.name}.reference.png`), reference);
    await rctx.close();

    const d = await diff(scratch, actual.toString("base64"), reference.toString("base64"));
    writeFileSync(join(OUT, `${target.name}.diff.png`), Buffer.from(d.png, "base64"));
    const row = { name: target.name, size: `${d.size[0]}×${d.size[1]} vs ${d.size[2]}×${d.size[3]}`, html: ((100 * d.different) / d.total).toFixed(2), png: "—" };
    if (target.png) {
      const p = await diff(scratch, actual.toString("base64"), readFileSync(join(DESIGN, target.png)).toString("base64"));
      writeFileSync(join(OUT, `${target.name}.png-diff.png`), Buffer.from(p.png, "base64"));
      row.png = ((100 * p.different) / p.total).toFixed(2);
    }
    rows.push(row);
    console.log(`${row.name}: ${row.html}% different from the reference HTML, ${row.png}% from the PNG (${row.size})`);
  }
} finally {
  await browser.close();
  for (const s of servers) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(s.pid), "/T", "/F"], { stdio: "ignore" });
    else s.kill("SIGTERM");
  }
}

writeFileSync(
  join(OUT, "report.md"),
  [
    "# Design comparison",
    "",
    "Generated by `pnpm design:compare` (scripts/design-compare.mjs). Share of pixels whose colour differs by more than",
    `${THRESHOLD}/255 in some channel. «HTML»: against the reference HTML rendered with the same Geist fonts (the`,
    "fair comparison). «PNG»: against the committed capture, made without Geist (different line breaks).",
    "",
    "| Page | Size (actual vs reference) | HTML | PNG |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.size} | ${r.html} % | ${r.png === "—" ? "—" : `${r.png} %`} |`),
    "",
  ].join("\n"),
);
