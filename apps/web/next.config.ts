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
  // Workspace packages are plain Node ESM (they read the filesystem): load
  // them at runtime instead of bundling them.
  serverExternalPackages: ["@exegezis/core", "@exegezis/planner", "@exegezis/search"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  // The end-to-end language test runs its own server without touching a running `pnpm web`.
  ...(process.env["EXEGEZIS_NEXT_DIST"] === undefined ? {} : { distDir: process.env["EXEGEZIS_NEXT_DIST"] }),
  devIndicators: false,
};

// next-intl without locale routing: the request config reads the language cookie.
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
