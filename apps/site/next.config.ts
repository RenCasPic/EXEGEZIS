import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// The repository's one .env (see .env.example), for this app too: variables
// already set in the environment win.
try {
  const file = join(repoRoot, ".env");
  if (existsSync(file)) for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) if (process.env[k] === undefined) process.env[k] = v;
} catch {
  // An unreadable .env is the same as none.
}

const config: NextConfig = {
  // A static site: `next build` writes it to out/, ready for any static host.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  devIndicators: false,
  // The end-to-end test and the screenshot script run their own server without touching a running `pnpm site`.
  ...(process.env["EXEGEZIS_NEXT_DIST"] === undefined ? {} : { distDir: process.env["EXEGEZIS_NEXT_DIST"] }),
};

// next-intl with the language in the URL (/en/, /es/): static, no cookies.
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
