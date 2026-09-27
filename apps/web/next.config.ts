import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const config: NextConfig = {
  // Workspace packages are plain Node ESM (they read the filesystem): load
  // them at runtime instead of bundling them.
  serverExternalPackages: ["@exegezis/core", "@exegezis/planner", "@exegezis/search"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  devIndicators: false,
};

// next-intl without locale routing: the request config reads the language cookie.
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
